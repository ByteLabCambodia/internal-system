import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CategorySeedService } from './category-seed.service';
import { CategoryEntity } from '../../../../inventory/entities/category.entity';
import { AccountEntity } from '../../../../accounting/entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity, AccountEntity])],
  providers: [CategorySeedService],
  exports: [CategorySeedService],
})
export class CategorySeedModule {}
