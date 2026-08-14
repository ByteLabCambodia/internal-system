import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from './entities/account.entity';
import { ExchangeRateEntity } from './entities/exchange-rate.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { JournalLineEntity } from './entities/journal-line.entity';
import { OrgModule } from '../org/org.module';
import { AccountsService } from './accounts.service';
import { RatesService } from './rates.service';
import { JournalService } from './journal.service';
import { ReportsService } from './reports.service';
import { AccountingController } from './accounting.controller';
import { ReportsController } from './reports.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountEntity,
      ExchangeRateEntity,
      JournalEntryEntity,
      JournalLineEntity,
    ]),
    OrgModule,
  ],
  controllers: [AccountingController, ReportsController],
  providers: [AccountsService, RatesService, JournalService, ReportsService],
  exports: [AccountsService, RatesService, JournalService, ReportsService],
})
export class AccountingModule {}
