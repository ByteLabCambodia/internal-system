import { registerAs } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { TelegramConfig } from './telegram-config.type';

class EnvironmentVariablesValidator {
  // All optional: without a bot token the whole integration stands down quietly and the
  // web app keeps working. See TelegramService.isConfigured.
  @IsOptional() @IsString() TELEGRAM_BOT_TOKEN?: string;
  @IsOptional() @IsString() TELEGRAM_WEBHOOK_SECRET?: string;
  @IsOptional() @IsString() TELEGRAM_MINIAPP_URL?: string;
}

export default registerAs<TelegramConfig>('telegram', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    miniAppUrl: process.env.TELEGRAM_MINIAPP_URL,
  };
});
