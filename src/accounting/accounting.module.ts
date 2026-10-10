import { Global, Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { AccountsService } from './accounts.service';
import { RatesService } from './rates.service';
import { JournalService } from './journal.service';
import { ReportsService } from './reports.service';
import { AccountingController } from './accounting.controller';
import { ReportsController } from './reports.controller';

@Global()
@Module({
  imports: [OrgModule],
  controllers: [AccountingController, ReportsController],
  providers: [AccountsService, RatesService, JournalService, ReportsService],
  exports: [AccountsService, RatesService, JournalService, ReportsService],
})
export class AccountingModule {}
