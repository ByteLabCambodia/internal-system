import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';
import { AuthWebModule } from '../auth/web/auth-web.module';
import { OrgModule } from '../org/org.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminOrgController } from './admin-org.controller';
import { AdminSettingsController } from './admin-settings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    UsersModule,
    SessionModule,
    AuthWebModule,
    OrgModule,
    TelegramModule,
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminOrgController,
    AdminSettingsController,
  ],
})
export class AdminModule {}
