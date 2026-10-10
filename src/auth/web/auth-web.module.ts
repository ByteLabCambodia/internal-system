import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { AuthTokensService } from '../auth-tokens.service';
import { MailModule } from '../../mail/mail.module';
import { SessionModule } from '../../session/session.module';
import { UsersModule } from '../../users/users.module';
import { AuthWebController } from './auth-web.controller';
import { WebAuthService } from './web-auth.service';

@Module({
  imports: [AuthModule, UsersModule, SessionModule, MailModule],
  controllers: [AuthWebController],
  providers: [WebAuthService, AuthTokensService],
  exports: [WebAuthService, AuthTokensService],
})
export class AuthWebModule {}
