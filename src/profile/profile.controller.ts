import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { IsOptional, IsString } from 'class-validator';
import { TelegramLinkService } from '../telegram/telegram-link.service';
import { TelegramService } from '../telegram/telegram.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { ActivityService } from '../activity/activity.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { NewPasswordFormDto } from '../auth/web/dto/new-password-form.dto';

export class ProfileDetailsDto {
  @IsOptional() @IsString() department?: string;

  /** Where finance sends a reimbursement — a payment link and/or a QR image. */
  @IsOptional() @IsString() paymentLink?: string;
  @IsOptional() @IsString() paymentQrObjectKey?: string;
}

/**
 * Profile: name, department, password change, and Telegram link/unlink. The payment
 * destination (link + QR) also lives here — it is what finance pays a reimbursement to.
 */
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly links: TelegramLinkService,
    private readonly telegram: TelegramService,
    private readonly storage: StorageService,
    private readonly usersService: UsersService,
    private readonly activity: ActivityService,
  ) {}

  private async view(response: Response, extra: Record<string, unknown> = {}) {
    const user = response.locals.currentUser;

    return response.render('profile/index', {
      title: 'Profile',
      user,
      telegramEnabled: this.telegram.isConfigured,
      storageEnabled: this.storage.isConfigured,
      // Short-lived view URL so the QR renders without a public bucket.
      paymentQrUrl: user.paymentQrObjectKey
        ? await this.storage.createViewUrl(user.paymentQrObjectKey)
        : null,
      linkToken: null,
      errors: {},
      ...extra,
    });
  }

  @Get()
  show(@Res() response: Response) {
    return this.view(response);
  }

  /** Department plus the payment destination finance pays reimbursements to. */
  @Post('details')
  async saveDetails(
    @Body() body: ProfileDetailsDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(ProfileDetailsDto, body);
    const user = response.locals.currentUser;

    if (!form.ok) {
      return response.status(422).render('profile/index', {
        title: 'Profile',
        user,
        telegramEnabled: this.telegram.isConfigured,
        storageEnabled: this.storage.isConfigured,
        paymentQrUrl: null,
        linkToken: null,
        errors: form.errors,
      });
    }

    await this.usersService.update(Number(user.id), {
      department: form.data.department ?? null,
      paymentLink: form.data.paymentLink ?? null,
      // An empty hidden field means the existing key is kept, not cleared.
      ...(form.data.paymentQrObjectKey
        ? { paymentQrObjectKey: form.data.paymentQrObjectKey }
        : {}),
    });

    setFlash(response, 'success', 'Profile updated.');
    return response.redirect('/profile');
  }

  @Post('password')
  async changePassword(
    @Body() body: NewPasswordFormDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(NewPasswordFormDto, body);
    const user = response.locals.currentUser;

    if (!form.ok || form.data.password !== form.data.passwordConfirmation) {
      return this.view(response, {
        errors: form.ok
          ? { passwordConfirmation: 'Both passwords must match' }
          : form.errors,
      });
    }

    await this.usersService.update(Number(user.id), {
      password: form.data.password,
      mustChangePassword: false,
    });

    await this.activity.log({
      entityType: 'user',
      entityId: Number(user.id),
      action: 'password_changed',
      actorId: Number(user.id),
    });

    setFlash(response, 'success', 'Password changed.');
    return response.redirect('/profile');
  }

  /** Generates the one-time code the user sends to the bot as `/link <code>`. */
  @Post('telegram/link')
  async link(@Res() response: Response) {
    const user = response.locals.currentUser;
    const { token, expiresAt } = await this.links.issueLinkToken(
      Number(user.id),
    );

    return this.view(response, { linkToken: { token, expiresAt } });
  }

  @Post('telegram/unlink')
  async unlink(@Res() response: Response) {
    await this.links.unlink(Number(response.locals.currentUser.id));

    setFlash(response, 'success', 'Telegram account unlinked.');
    return response.redirect('/profile');
  }
}
