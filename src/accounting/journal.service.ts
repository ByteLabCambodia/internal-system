import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { JournalLineEntity } from './entities/journal-line.entity';
import { AccountEntity } from './entities/account.entity';
import {
  AccountTypeEnum,
  CurrencyEnum,
  JournalSourceEnum,
} from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { RatesService } from './rates.service';
import { ActivityService } from '../activity/activity.service';
import { User } from '../users/domain/user';
import { RecordIncomeDto } from './dto/record-income.dto';

@Injectable()
export class JournalService {
  constructor(
    @InjectRepository(JournalEntryEntity)
    private readonly entries: Repository<JournalEntryEntity>,
    @InjectRepository(AccountEntity)
    private readonly accounts: Repository<AccountEntity>,
    private readonly dataSource: DataSource,
    private readonly money: MoneyService,
    private readonly rates: RatesService,
    private readonly activity: ActivityService,
  ) {}

  async list(filters: {
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: JournalEntryEntity[]; count: number }> {
    const query = this.entries
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.lines', 'lines')
      .leftJoinAndSelect('lines.account', 'account')
      .leftJoinAndSelect('entry.createdBy', 'createdBy');

    if (filters.from) {
      query.andWhere('entry.entry_date >= :from', { from: filters.from });
    }
    if (filters.to) {
      query.andWhere('entry.entry_date <= :to', { to: filters.to });
    }

    const [rows, count] = await query
      .orderBy('entry.entryDate', 'DESC')
      .addOrderBy('entry.id', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { rows, count };
  }

  findIncomeAccounts(): Promise<AccountEntity[]> {
    return this.accounts.find({
      where: { type: AccountTypeEnum.income, active: true },
      order: { code: 'ASC' },
    });
  }

  /**
   * Manual income: DR 1000 Cash / CR the chosen income account, in one balanced entry.
   * The deferred constraint trigger T2 checks the balance at commit, so a half-written
   * entry can never survive.
   */
  async recordIncome(actor: User, dto: RecordIncomeDto): Promise<number> {
    const cash = await this.accounts.findOne({ where: { code: '1000' } });
    const income = await this.accounts.findOne({
      where: { id: dto.incomeAccountId, type: AccountTypeEnum.income },
    });

    if (!cash) {
      throw new UnprocessableEntityException(
        'The chart of accounts is missing 1000 Cash / Bank.',
      );
    }
    if (!income) {
      throw new UnprocessableEntityException('Choose an income account.');
    }

    const exchangeRate = await this.rates.getCurrentRate(dto.currency);
    if (!exchangeRate) {
      throw new UnprocessableEntityException(
        `No exchange rate on file for ${dto.currency}. Set today's rate first.`,
      );
    }

    const amountUsd = this.money.toUsd(dto.amountOriginal, exchangeRate);

    const entryId = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.save(
        manager.create(JournalEntryEntity, {
          entryDate: dto.entryDate || new Date().toISOString().slice(0, 10),
          memo: dto.memo || 'Manual income',
          currency: dto.currency,
          exchangeRate,
          source: JournalSourceEnum.manual_income,
          createdBy: { id: Number(actor.id) } as never,
        }),
      );

      await manager.save([
        manager.create(JournalLineEntity, {
          entry: { id: entry.id } as never,
          account: { id: cash.id } as never,
          debitUsd: amountUsd,
          creditUsd: '0',
          department: dto.departmentId
            ? ({ id: dto.departmentId } as never)
            : null,
          project: dto.projectId ? ({ id: dto.projectId } as never) : null,
        }),
        manager.create(JournalLineEntity, {
          entry: { id: entry.id } as never,
          account: { id: income.id } as never,
          debitUsd: '0',
          creditUsd: amountUsd,
          department: dto.departmentId
            ? ({ id: dto.departmentId } as never)
            : null,
          project: dto.projectId ? ({ id: dto.projectId } as never) : null,
        }),
      ]);

      return entry.id;
    });

    await this.activity.log({
      entityType: 'payment',
      entityId: entryId,
      action: 'income_recorded',
      actorId: Number(actor.id),
      detail: {
        amountOriginal: dto.amountOriginal,
        currency: dto.currency,
        amountUsd,
        account: income.code,
      },
    });

    return entryId;
  }

  /** Cash balance = debits minus credits on account 1000, in USD. */
  async cashBalance(): Promise<string> {
    const row = await this.dataSource.query<{ balance: string }[]>(`
      SELECT COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS balance
      FROM journal_lines l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.code = '1000'
    `);

    return row[0]?.balance ?? '0';
  }

  /** This month's expense, for the dashboard KPI. */
  async expenseThisMonth(): Promise<string> {
    const row = await this.dataSource.query<{ total: string }[]>(`
      SELECT COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS total
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE a.type = 'expense'
        AND e.entry_date >= date_trunc('month', current_date)
    `);

    return row[0]?.total ?? '0';
  }

  currencies(): CurrencyEnum[] {
    return Object.values(CurrencyEnum);
  }
}
