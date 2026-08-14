import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth.module';
import { AuthTokensService } from '../auth-tokens.service';
import { AuthTokenEntity } from '../entities/auth-token.entity';
import { MailModule } from '../../mail/mail.module';
import { SessionModule } from '../../session/session.module';
import { UsersModule } from '../../users/users.module';
import { AuthWebController } from './auth-web.controller';
import { WebAuthService } from './web-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthTokenEntity]),
    AuthModule,
    UsersModule,
    SessionModule,
    MailModule,
  ],
  controllers: [AuthWebController],
  providers: [WebAuthService, AuthTokensService],
  exports: [WebAuthService, AuthTokensService],
})
export class AuthWebModule {}
