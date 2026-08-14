import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseRequestEntity } from './entities/purchase-request.entity';
import { PurchaseRequestItemEntity } from './entities/purchase-request-item.entity';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PaymentEntity } from './entities/payment.entity';
import { CategoryEntity } from '../inventory/entities/category.entity';
import { OrgModule } from '../org/org.module';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PaymentsService } from './payments.service';
import { OcrService } from './ocr.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseRequestEntity,
      PurchaseRequestItemEntity,
      PurchaseOrderEntity,
      PurchaseOrderItemEntity,
      PaymentEntity,
      CategoryEntity,
    ]),
    OrgModule,
  ],
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
