import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { SuppliersService } from './suppliers.service';
import { ApprovalThresholdsService } from './approval-thresholds.service';
import { SuppliersController } from './suppliers.controller';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';

@Module({
  controllers: [SuppliersController, CustomersController],
  providers: [
    OrgService,
    SuppliersService,
    CustomersService,
    ApprovalThresholdsService,
  ],
  exports: [
    OrgService,
    SuppliersService,
    CustomersService,
    ApprovalThresholdsService,
  ],
})
export class OrgModule {}
