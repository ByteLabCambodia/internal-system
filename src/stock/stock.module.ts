import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockRequestEntity } from './entities/stock-request.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { OrgModule } from '../org/org.module';
import { StockRequestsService } from './stock-requests.service';
import { StockRequestsController } from './stock-requests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StockRequestEntity]),
    InventoryModule,
    OrgModule,
  ],
  controllers: [StockRequestsController],
  providers: [StockRequestsService],
  exports: [StockRequestsService],
})
export class StockModule {}
