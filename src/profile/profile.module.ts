import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { ActivityModule } from '../activity/activity.module';
import { ProfileController } from './profile.controller';

@Module({
  imports: [TelegramModule, UsersModule, ActivityModule],
  controllers: [ProfileController],
})
export class ProfileModule {}
