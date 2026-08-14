import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard } from 'grammy';
import { AllConfigType } from '../config/config.type';

export type SendOptions = {
  chatId: string | number;
  text: string;
  keyboard?: InlineKeyboard;
};

/**
 * The only place that talks to the Bot API. Business logic goes through
 * NotificationsService.notify() and never touches this directly.
 *
 * Every send is a direct message to a user's own linked Telegram account — there is no
 * group chat or forum topic in this integration. Every send is best-effort: a Telegram
 * outage must not roll back a purchase order.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot | null = null;

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  onModuleInit() {
    const token = this.configService.get('telegram.botToken', { infer: true });

    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is not set; Telegram notifications are disabled',
      );
      return;
    }

    this.bot = new Bot(token);
  }

  get isConfigured(): boolean {
    return this.bot !== null;
  }

  /** Raw access for the webhook handler, which needs to answer callback queries. */
  get api() {
    return this.bot?.api ?? null;
  }

  get webhookSecret(): string | undefined {
    return this.configService.get('telegram.webhookSecret', { infer: true });
  }

  get miniAppUrl(): string | undefined {
    return this.configService.get('telegram.miniAppUrl', { infer: true });
  }

  /** Returns the sent message id, or null when the send was skipped or failed. */
  async send(options: SendOptions): Promise<number | null> {
    if (!this.bot || !options.chatId) return null;

    try {
      const message = await this.bot.api.sendMessage(
        options.chatId,
        options.text,
        {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(options.keyboard ? { reply_markup: options.keyboard } : {}),
        },
      );

      return message.message_id;
    } catch (error) {
      this.logger.error(
        `Telegram send to ${options.chatId} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async setWebhook(url: string): Promise<{ ok: boolean; message: string }> {
    if (!this.bot) {
      return { ok: false, message: 'No bot token configured.' };
    }

    try {
      // Notification action buttons are plain URL links, not inline callbacks, so this
      // bot only needs message updates (/link, /start) — no callback_query.
      await this.bot.api.setWebhook(url, {
        secret_token: this.webhookSecret,
        allowed_updates: ['message'],
      });

      let menuButtonMessage = '';

      // TELEGRAM_MINIAPP_URL, if set, becomes the bot's persistent menu button — the
      // same thing BotFather's "Menu Button" setting does, kept in sync from here so it
      // does not have to be set by hand in two places.
      if (this.miniAppUrl) {
        await this.bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: 'Open app',
            web_app: { url: this.miniAppUrl },
          },
        });
        menuButtonMessage = ` Menu button set to ${this.miniAppUrl}.`;
      }

      return {
        ok: true,
        message: `Webhook set to ${url}.${menuButtonMessage}`,
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }
}
