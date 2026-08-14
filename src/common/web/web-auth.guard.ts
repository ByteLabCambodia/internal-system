import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { AllConfigType } from '../../config/config.type';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import { RoleEnum } from '../../roles/roles.enum';
import { IS_PUBLIC_PAGE } from './public-page.decorator';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './web.constants';
import { clearAuthCookies, setAuthCookies } from './auth-cookies';

class RedirectToLogin extends Error {}

/**
 * Page routes authenticate from an httpOnly cookie holding the access token, refreshing it
 * transparently when it has expired. The Mini App and the JSON API keep using the bearer
 * token strategy — one AuthGuard concept, two entry points.
 *
 * Unauthenticated page requests redirect to /login with the originally requested URL, not
 * a 401 body.
 */
@Injectable()
export class WebAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // The JSON API and the Swagger docs authenticate by bearer token, not by cookie.
    const apiPrefix = this.configService.get('app.apiPrefix', { infer: true });
    if (
      request.path.startsWith(`/${apiPrefix}`) ||
      request.path.startsWith('/docs')
    ) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_PAGE, [
      context.getHandler(),
      context.getClass(),
    ]);

    try {
      const payload = await this.resolvePayload(request, response);
      const user = await this.usersService.findById(payload.id);

      if (!user || !user.active) {
        throw new RedirectToLogin();
      }

      request.user = payload;
      response.locals.currentUser = user;
      response.locals.can = this.permissions.grantsFor(user);
      response.locals.roleName = user.role?.id
        ? RoleEnum[Number(user.role.id)]
        : '';

      // A user whose password was set by an admin goes nowhere until they change it.
      if (
        user.mustChangePassword &&
        !request.path.startsWith('/set-password') &&
        !request.path.startsWith('/logout')
      ) {
        response.redirect('/set-password');
        return false;
      }

      return true;
    } catch {
      if (isPublic) {
        return true;
      }

      clearAuthCookies(response);

      const next = encodeURIComponent(request.originalUrl);
      response.redirect(`/login?next=${next}`);
      return false;
    }
  }

  private async resolvePayload(
    request: Request,
    response: Response,
  ): Promise<JwtPayloadType> {
    const accessToken = request.cookies?.[ACCESS_TOKEN_COOKIE];

    if (accessToken) {
      try {
        return await this.jwtService.verifyAsync<JwtPayloadType>(accessToken, {
          secret: this.configService.getOrThrow('auth.secret', { infer: true }),
        });
      } catch {
        // fall through to the refresh attempt
      }
    }

    const refreshToken = request.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      throw new RedirectToLogin();
    }

    const refreshPayload = await this.jwtService
      .verifyAsync<{ sessionId: number; hash: string }>(refreshToken, {
        secret: this.configService.getOrThrow('auth.refreshSecret', {
          infer: true,
        }),
      })
      .catch(() => {
        throw new RedirectToLogin();
      });

    const refreshed = await this.authService
      .refreshToken({
        sessionId: refreshPayload.sessionId,
        hash: refreshPayload.hash,
      })
      .catch(() => {
        throw new RedirectToLogin();
      });

    setAuthCookies(response, refreshed);

    return this.jwtService.verifyAsync<JwtPayloadType>(refreshed.token, {
      secret: this.configService.getOrThrow('auth.secret', { infer: true }),
    });
  }
}
