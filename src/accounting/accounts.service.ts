import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountTypeEnum } from '../common/enums';

export const MISC_EXPENSE_ACCOUNT_CODE = '6900';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private get accounts() {
    return this.prisma.db.orm.public.Account;
  }

  async findAll() {
    return await this.accounts.orderBy((a) => a.code.asc()).all();
  }

  async findExpenseAccounts() {
    return await this.accounts
      .where({ type: AccountTypeEnum.expense, active: true })
      .orderBy((a) => a.code.asc())
      .all();
  }

  async findByCode(code: string) {
    return await this.accounts.where({ code }).first();
  }

  async findById(id: number) {
    return await this.accounts.where({ id }).first();
  }
}
