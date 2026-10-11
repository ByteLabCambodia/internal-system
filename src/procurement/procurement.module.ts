import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PaymentsService } from './payments.service';
import { OcrService } from './ocr.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [OrgModule],
  controllers: [
    PurchaseRequestsController,
    PurchaseOrdersController,
    PaymentsController,
  ],
  providers: [
    PurchaseRequestsService,
    PurchaseOrdersService,
    PaymentsService,
    OcrService,
  ],
  exports: [PurchaseRequestsService, PurchaseOrdersService, PaymentsService],
})
export class ProcurementModule {}
