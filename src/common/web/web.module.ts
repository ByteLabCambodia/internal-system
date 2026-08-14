import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../../auth/auth.module';
import { UsersModule } from '../../users/users.module';
import { CsrfMiddleware } from './csrf.middleware';
import { ViewGlobalsMiddleware } from './view-globals.middleware';
import { WebAuthGuard } from './web-auth.guard';
import { PermissionsGuard } from '../../permissions/permissions.guard';

/**
 * The page layer: view globals, CSRF on every state-changing form post, cookie auth, and
 * the permission guard. The guards are global but stand down for /api and /docs, which
 * keep the bearer-token strategy.
 */
@Global()
@Module({
  imports: [AuthModule, UsersModule],
  providers: [
    { provide: APP_GUARD, useClass: WebAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class WebModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ViewGlobalsMiddleware, CsrfMiddleware).forRoutes('*splat');
  }
}
