import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import Tokens from 'csrf';
import { AllConfigType } from '../../config/config.type';
import { CSRF_SECRET_COOKIE } from './web.constants';

const tokens = new Tokens();
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Server actions used to carry CSRF protection for free; every state-changing form now
 * needs a token (Part 1c, "Three things that genuinely change"). Secret in an httpOnly
 * cookie, token rendered into a hidden field by the form partial.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  use(request: Request, response: Response, next: NextFunction) {
    // The JSON API is bearer-token authenticated and not cookie-driven, so it is not
    // exposed to CSRF and must not be asked for a token.
    //
    // The Telegram webhook is exempt for the same reason: the caller is Telegram, not a
    // browser with our cookies, and it authenticates with the secret-token header plus
    // `telegram_updates` idempotency instead. Every other /telegram route keeps CSRF.
    const apiPrefix = this.configService.get('app.apiPrefix', { infer: true });
    if (
      request.path.startsWith(`/${apiPrefix}`) ||
      request.path.startsWith('/docs') ||
      request.path === '/telegram/webhook'
    ) {
      return next();
    }

    let secret = request.cookies?.[CSRF_SECRET_COOKIE];

    if (!secret) {
      secret = tokens.secretSync();
      response.cookie(CSRF_SECRET_COOKIE, secret, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    }

    response.locals.csrfToken = tokens.create(secret);

    if (!SAFE_METHODS.has(request.method)) {
      const supplied =
        (request.body as Record<string, unknown> | undefined)?._csrf ??
        request.headers['x-csrf-token'];

      if (typeof supplied !== 'string' || !tokens.verify(secret, supplied)) {
        throw new ForbiddenException('Invalid or missing CSRF token');
      }
    }

    next();
  }
}
