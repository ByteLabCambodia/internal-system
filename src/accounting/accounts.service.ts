import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from './entities/account.entity';
import { AccountTypeEnum } from '../common/enums';

export const MISC_EXPENSE_ACCOUNT_CODE = '6900';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
  ) {}

  findAll(): Promise<AccountEntity[]> {
    return this.repository.find({ order: { code: 'ASC' } });
  }

  findExpenseAccounts(): Promise<AccountEntity[]> {
    return this.repository.find({
      where: { type: AccountTypeEnum.expense, active: true },
      order: { code: 'ASC' },
    });
  }

  findByCode(code: string): Promise<AccountEntity | null> {
    return this.repository.findOne({ where: { code } });
  }

  findById(id: number): Promise<AccountEntity | null> {
    return this.repository.findOne({ where: { id } });
  }
}
