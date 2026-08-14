import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AllConfigType } from '../config/config.type';
import { PublicPage } from '../common/web/public-page.decorator';

/**
 * One EJS shell. The screens are client-side against /api/v1/miniapp/* — a Telegram
 * webview should not do full page loads (Part 1c).
 */
@Controller('miniapp')
export class MiniAppController {
  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  @PublicPage()
  @Get()
  shell(@Res() response: Response) {
    return response.render('miniapp/shell', {
      layout: false,
      title: 'Operations',
      appName:
        this.configService.get('app.name', { infer: true }) ?? 'Operations',
    });
  }
}
