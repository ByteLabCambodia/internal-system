import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountSeedService } from './account-seed.service';
import { AccountEntity } from '../../../../accounting/entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AccountEntity])],
  providers: [AccountSeedService],
  exports: [AccountSeedService],
})
export class AccountSeedModule {}
