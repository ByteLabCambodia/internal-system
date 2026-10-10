import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { TelegramService } from './telegram.service';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [
    // TelegramLinkService still reads users through TypeORM until users move to Prisma.
    TypeOrmModule.forFeature([UserEntity]),
    UsersModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramLinkService],
  exports: [TelegramService, TelegramLinkService],
})
export class TelegramModule {}
