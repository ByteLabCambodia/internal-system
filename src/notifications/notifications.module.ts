import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from './entities/notification.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity, UserEntity]),
    TelegramModule,
  ],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
