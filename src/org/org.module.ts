import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { SuppliersService } from './suppliers.service';
import { ApprovalThresholdsService } from './approval-thresholds.service';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [SuppliersController],
  providers: [OrgService, SuppliersService, ApprovalThresholdsService],
  exports: [OrgService, SuppliersService, ApprovalThresholdsService],
})
export class OrgModule {}
