import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../../accounting/entities/account.entity';
import { CategoryEntity } from '../../../../inventory/entities/category.entity';

// C1: every category maps to the GL account its spend debits.
const CATEGORIES: { name: string; accountCode: string }[] = [
  { name: 'Electronics', accountCode: '6100' },
  { name: 'Office Supplies', accountCode: '6000' },
  { name: 'Tools', accountCode: '6100' },
  { name: 'Materials', accountCode: '6100' },
];

@Injectable()
export class CategorySeedService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly repository: Repository<CategoryEntity>,
    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
  ) {}

  async run() {
    for (const category of CATEGORIES) {
      const existing = await this.repository.findOne({
        where: { name: category.name },
      });

      if (existing) continue;

      const expenseAccount = await this.accountRepository.findOne({
        where: { code: category.accountCode },
      });

      await this.repository.save(
        this.repository.create({
          name: category.name,
          expenseAccount,
        }),
      );
    }
  }
}
