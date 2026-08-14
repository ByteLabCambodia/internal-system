import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItemEntity } from './entities/inventory-item.entity';
import { InventoryClaimEntity } from './entities/inventory-claim.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { CategoryEntity } from './entities/category.entity';
import { PurchaseOrderItemEntity } from '../procurement/entities/purchase-order-item.entity';
import { AppSettingEntity } from '../settings/entities/app-setting.entity';
import { InventoryService } from './inventory.service';
import { CategoriesService } from './categories.service';
import { ClaimsService } from './claims.service';
import { InventoryController } from './inventory.controller';
import { ClaimsController } from './claims.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryItemEntity,
      InventoryClaimEntity,
      StockMovementEntity,
      CategoryEntity,
      PurchaseOrderItemEntity,
      AppSettingEntity,
    ]),
  ],
  controllers: [InventoryController, ClaimsController],
  providers: [InventoryService, CategoriesService, ClaimsService],
  exports: [InventoryService, CategoriesService, ClaimsService],
})
export class InventoryModule {}
