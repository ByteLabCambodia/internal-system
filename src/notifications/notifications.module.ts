import { Global, Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [TelegramModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
