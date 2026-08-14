import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { InventoryModule } from '../inventory/inventory.module';
import { StockModule } from '../stock/stock.module';
import { OrgModule } from '../org/org.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MiniAppController } from './miniapp.controller';
import { MiniAppApiController } from './miniapp.api.controller';
import { MiniAppAuthGuard } from './miniapp-auth.guard';

@Module({
  imports: [
    TelegramModule,
    UsersModule,
    ProcurementModule,
    InventoryModule,
    StockModule,
    OrgModule,
    NotificationsModule,
  ],
  controllers: [MiniAppController, MiniAppApiController],
  providers: [MiniAppAuthGuard],
})
export class MiniAppModule {}
