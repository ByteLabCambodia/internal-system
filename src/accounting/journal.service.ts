import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  AccountTypeEnum,
  CurrencyEnum,
  JournalSourceEnum,
} from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { money, rate } from '../prisma/numeric';
import { textRow } from '../prisma/raw';
import { RatesService } from './rates.service';
import { ActivityService } from '../activity/activity.service';
import { User } from '../users/domain/user';
import { RecordIncomeDto } from './dto/record-income.dto';

type JournalLineInput = {
  accountId: number;
  debitUsd: string;
  creditUsd: string;
  departmentId: number | null;
  projectId: number | null;
};

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly rates: RatesService,
    private readonly activity: ActivityService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async list(filters: {
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    let entries = this.db.orm.public.JournalEntry.where({});
    if (filters.from) {
      const from = filters.from;
      entries = entries.where((e) => e.entryDate.gte(from));
    }
    if (filters.to) {
      const to = filters.to;
      entries = entries.where((e) => e.entryDate.lte(to));
    }

    const [rows, total] = await Promise.all([
      entries
        .include('lines', (lines) =>
          lines.include('account').orderBy((l) => l.id.asc()),
        )
        .include('createdBy')
        .orderBy([(e) => e.entryDate.desc(), (e) => e.id.desc()])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      entries.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findIncomeAccounts() {
    return await this.db.orm.public.Account.where({
      type: AccountTypeEnum.income,
      active: true,
    })
      .orderBy((a) => a.code.asc())
      .all();
  }

  /** One entry and its lines. Runs in the caller's transaction (also used by sales). */
  async post(
    tx: Tx,
    entry: {
      entryDate: string;
      memo: string;
      currency: CurrencyEnum;
      exchangeRate: string;
      source: JournalSourceEnum;
      sourceRef: number | null;
      createdById: number;
    },
    lines: JournalLineInput[],
  ): Promise<number> {
    const created = await tx.orm.public.JournalEntry.create({
      ...entry,
      exchangeRate: rate(entry.exchangeRate),
    });

    await tx.orm.public.JournalLine.createAll(
      lines.map((line) => ({
        entryId: created.id,
        accountId: line.accountId,
        debitUsd: money(line.debitUsd),
        creditUsd: money(line.creditUsd),
        dimensionDepartmentId: line.departmentId,
        dimensionProjectId: line.projectId,
      })),
    );

    return created.id;
  }

  /**
   * Manual income: DR 1000 Cash / CR the chosen income account, in one balanced entry.
   * The deferred constraint trigger T2 checks the balance at commit, so a half-written
   * entry can never survive.
   */
  async recordIncome(actor: User, dto: RecordIncomeDto): Promise<number> {
    const accounts = this.db.orm.public.Account;
    const cash = await accounts.where({ code: '1000' }).first();
    const income = await accounts
      .where({ id: dto.incomeAccountId, type: AccountTypeEnum.income })
      .first();

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

    const dimensions = {
      departmentId: dto.departmentId || null,
      projectId: dto.projectId || null,
    };

    const entryId = await this.db.transaction((tx) =>
      this.post(
        tx,
        {
          entryDate: dto.entryDate || new Date().toISOString().slice(0, 10),
          memo: dto.memo || 'Manual income',
          currency: dto.currency,
          exchangeRate,
          source: JournalSourceEnum.manual_income,
          sourceRef: null,
          createdById: Number(actor.id),
        },
        [
          {
            accountId: cash.id,
            debitUsd: amountUsd,
            creditUsd: '0',
            ...dimensions,
          },
          {
            accountId: income.id,
            debitUsd: '0',
            creditUsd: amountUsd,
            ...dimensions,
          },
        ],
      ),
    );

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

  /**
   * A payment, cash-basis (C5a): DR expense / CR 1000 Cash, nothing touches 2000 A/P.
   * Runs inside the caller's transaction so the payment and its entry commit together.
   * The expense account is the caller's choice if any (C1), else 6900 Miscellaneous.
   */
  async postPayment(
    tx: Tx,
    payment: {
      id: number;
      paidAt: Date;
      memo: string;
      currency: CurrencyEnum;
      exchangeRate: string;
      amountUsd: string;
      expenseAccountId: number | null;
      departmentId: number | null;
      projectId: number | null;
      actorId: number;
    },
  ): Promise<number> {
    const accounts = tx.orm.public.Account;
    const cash = await accounts.where({ code: '1000' }).first();
    const expenseAccountId =
      payment.expenseAccountId ??
      (await accounts.where({ code: '6900' }).first())?.id;

    if (!cash || !expenseAccountId) {
      throw new UnprocessableEntityException(
        'chart of accounts is not seeded: 1000 and 6900 are required',
      );
    }

    const dimensions = {
      departmentId: payment.departmentId,
      projectId: payment.projectId,
    };

    return this.post(
      tx,
      {
        entryDate: payment.paidAt.toISOString().slice(0, 10),
        memo: payment.memo,
        currency: payment.currency,
        exchangeRate: payment.exchangeRate,
        source: JournalSourceEnum.po_payment,
        sourceRef: payment.id,
        createdById: payment.actorId,
      },
      [
        {
          accountId: expenseAccountId,
          debitUsd: payment.amountUsd,
          creditUsd: '0',
          ...dimensions,
        },
        {
          accountId: cash.id,
          debitUsd: '0',
          creditUsd: payment.amountUsd,
          ...dimensions,
        },
      ],
    );
  }

  /** Cash balance = debits minus credits on account 1000, in USD. */
  async cashBalance(): Promise<string> {
    const [row] = await this.db.runtime().query(
      this.db.raw.sql`
        SELECT COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS balance
        FROM journal_lines l
        JOIN accounts a ON a.id = l.account_id
        WHERE a.code = '1000'
      `
        .returnsRow(textRow('balance'))
        .build(),
    );

    return row?.balance ?? '0';
  }

  /** This month's expense, for the dashboard KPI. */
  async expenseThisMonth(): Promise<string> {
    const [row] = await this.db.runtime().query(
      this.db.raw.sql`
        SELECT COALESCE(SUM(l.debit_usd - l.credit_usd), 0)::text AS total
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id
        JOIN accounts a ON a.id = l.account_id
        WHERE a.type = 'expense'
          AND e.entry_date >= date_trunc('month', current_date)
      `
        .returnsRow(textRow('total'))
        .build(),
    );

    return row?.total ?? '0';
  }

  currencies(): CurrencyEnum[] {
    return Object.values(CurrencyEnum);
  }
}
