import { Module } from '@nestjs/common';
import { ProcurementModule } from '../procurement/procurement.module';
import { InventoryService } from './inventory.service';
import { CategoriesService } from './categories.service';
import { ClaimsService } from './claims.service';
import { InventoryController } from './inventory.controller';
import { ClaimsController } from './claims.controller';

@Module({
  imports: [ProcurementModule],
  controllers: [InventoryController, ClaimsController],
  providers: [InventoryService, CategoriesService, ClaimsService],
  exports: [InventoryService, CategoriesService, ClaimsService],
})
export class InventoryModule {}
