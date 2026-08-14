import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../../accounting/entities/account.entity';
import { AccountTypeEnum } from '../../../../common/enums';

export const CHART_OF_ACCOUNTS: {
  code: string;
  name: string;
  type: AccountTypeEnum;
}[] = [
  { code: '1000', name: 'Cash / Bank', type: AccountTypeEnum.asset },
  { code: '2000', name: 'Accounts Payable', type: AccountTypeEnum.liability },
  { code: '3000', name: 'Owner Equity', type: AccountTypeEnum.equity },
  {
    code: '4000',
    name: 'Sales / Service Income',
    type: AccountTypeEnum.income,
  },
  {
    code: '6000',
    name: 'Office Supplies Expense',
    type: AccountTypeEnum.expense,
  },
  {
    code: '6100',
    name: 'IT / Components Expense',
    type: AccountTypeEnum.expense,
  },
  { code: '6900', name: 'Misc Expense', type: AccountTypeEnum.expense },
];

@Injectable()
export class AccountSeedService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
  ) {}

  async run() {
    for (const account of CHART_OF_ACCOUNTS) {
      const existing = await this.repository.findOne({
        where: { code: account.code },
      });

      if (!existing) {
        await this.repository.save(this.repository.create(account));
      }
    }
  }
}
