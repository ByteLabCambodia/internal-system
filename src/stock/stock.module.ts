import { Module } from '@nestjs/common';
import { ProcurementModule } from '../procurement/procurement.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrgModule } from '../org/org.module';
import { StockRequestsService } from './stock-requests.service';
import { StockRequestsController } from './stock-requests.controller';

@Module({
  imports: [InventoryModule, ProcurementModule, OrgModule],
  controllers: [StockRequestsController],
  providers: [StockRequestsService],
  exports: [StockRequestsService],
})
export class StockModule {}
