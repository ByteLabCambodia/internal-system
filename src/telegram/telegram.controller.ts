import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InlineKeyboard } from 'grammy';
import { TelegramService } from './telegram.service';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramUpdateEntity } from './entities/telegram-update.entity';
import { AllConfigType } from '../config/config.type';
import { PublicPage } from '../common/web/public-page.decorator';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
};

@Controller('telegram')
export class TelegramController {
  constructor(
    @InjectRepository(TelegramUpdateEntity)
    private readonly updates: Repository<TelegramUpdateEntity>,
    private readonly telegram: TelegramService,
    private readonly links: TelegramLinkService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /**
   * Webhook. Hardened two ways: the secret-token header must match, and `update_id` is
   * inserted into `telegram_updates` first — a replayed update loses the race on the
   * primary key and is dropped.
   *
   * Notification action buttons are plain URL links (see NotificationsService.linkFor), not
   * inline callback buttons, so there is no callback_query to handle here — tapping one
   * just opens the browser client-side, no webhook round trip involved.
   */
  @PublicPage()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    const expected = this.telegram.webhookSecret;

    if (expected && secret !== expected) {
      throw new ForbiddenException('Bad webhook secret');
    }

    if (!update?.update_id) return { ok: true };

    try {
      await this.updates.insert({ updateId: String(update.update_id) });
    } catch {
      // Already processed — Telegram retries on any non-200, so this is expected traffic.
      return { ok: true, duplicate: true };
    }

    // `/link <token>` from a direct chat.
    const text = update.message?.text?.trim() ?? '';
    if (text.startsWith('/link') && update.message?.from) {
      const token = text.split(/\s+/)[1];

      const result = token
        ? await this.links.consumeLinkToken(
            token,
            String(update.message.from.id),
            update.message.from.username,
          )
        : {
            ok: false,
            message:
              'Send /link followed by the code from your profile page, e.g. /link a1b2c3.',
          };

      await this.telegram.send({
        chatId: update.message.chat.id,
        text: result.message,
      });
    } else if (text.startsWith('/start') && update.message) {
      // The web_app button only appears once TELEGRAM_MINIAPP_URL is set — Telegram
      // rejects http:// and unset URLs outright, so this degrades to text-only rather
      // than sending a broken button.
      const miniAppUrl = this.telegram.miniAppUrl;
      const keyboard = miniAppUrl
        ? new InlineKeyboard().webApp('Open app', miniAppUrl)
        : undefined;

      await this.telegram.send({
        chatId: update.message.chat.id,
        text: 'Link this chat to your account with <code>/link &lt;code&gt;</code>. Generate a code on your profile page.',
        keyboard,
      });
    }

    return { ok: true };
  }

  /** Registers the webhook URL with Telegram. Admin only. */
  @RequirePermission(PermissionEnum['users.manage'])
  @Post('setup')
  async setup(@Res() response: Response) {
    const base = this.configService.getOrThrow('app.backendDomain', {
      infer: true,
    });

    const result = await this.telegram.setWebhook(`${base}/telegram/webhook`);

    setFlash(response, result.ok ? 'success' : 'error', result.message);
    return response.redirect('/admin/settings');
  }
}
