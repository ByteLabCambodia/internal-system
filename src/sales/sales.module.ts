import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { SalesService } from './sales.service';
import { PdfService } from './pdf.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [OrgModule],
  controllers: [SalesController],
  providers: [SalesService, PdfService],
  exports: [SalesService],
})
export class SalesModule {}
