import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import { Request } from 'express';
import { AllConfigType } from '../config/config.type';
import { TelegramLinkService } from '../telegram/telegram-link.service';
import { UsersService } from '../users/users.service';

export type MiniAppUser = { telegramId: string; username?: string };

/**
 * The Mini App authenticates by validating Telegram's `initData` HMAC — not by cookie.
 * One AuthGuard concept, two entry points (Part 3): the browser uses WebAuthGuard, the
 * webview uses this.
 *
 * initData is signed with HMAC-SHA256 using a key derived from the bot token, per
 * Telegram's documented scheme. An unlinked Telegram id gets through the signature check
 * but has no profile, which the controller reports as "link your account first".
 */
@Injectable()
export class MiniAppAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly links: TelegramLinkService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const initData =
      (request.headers['x-telegram-init-data'] as string | undefined) ??
      (request.body as { initData?: string } | undefined)?.initData;

    if (!initData) {
      throw new UnauthorizedException('Missing Telegram init data');
    }

    const verified = this.verify(initData);
    if (!verified) {
      throw new UnauthorizedException('Invalid Telegram init data');
    }

    request['telegramUser'] = verified;

    const entity = await this.links.findByTelegramId(verified.telegramId);
    if (entity) {
      // Load the domain user so services see the role relation they expect.
      request['user'] =
        (await this.usersService.findById(entity.id)) ?? undefined;
    }

    return true;
  }

  private verify(initData: string): MiniAppUser | null {
    const token = this.configService.get('telegram.botToken', { infer: true });
    if (!token) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    const checkString = [...params.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');

    const secret = crypto
      .createHmac('sha256', 'WebAppData')
      .update(token)
      .digest();

    const computed = crypto
      .createHmac('sha256', secret)
      .update(checkString)
      .digest('hex');

    // Constant-time compare: this is an authentication decision.
    const expected = Buffer.from(computed, 'hex');
    const supplied = Buffer.from(hash, 'hex');

    if (
      expected.length !== supplied.length ||
      !crypto.timingSafeEqual(expected, supplied)
    ) {
      return null;
    }

    // Reject stale init data (Telegram recommends checking auth_date).
    const authDate = Number(params.get('auth_date') ?? 0);
    if (authDate && Date.now() / 1000 - authDate > 24 * 60 * 60) return null;

    try {
      const user = JSON.parse(params.get('user') ?? '{}') as {
        id?: number;
        username?: string;
      };

      if (!user.id) return null;

      return { telegramId: String(user.id), username: user.username };
    } catch {
      return null;
    }
  }
}
