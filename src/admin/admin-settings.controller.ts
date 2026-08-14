import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { SettingsService } from '../settings/settings.service';
import { ApprovalThresholdsService } from '../org/approval-thresholds.service';
import { TelegramService } from '../telegram/telegram.service';
import { StorageService } from '../storage/storage.service';
import { RoleEnum } from '../roles/roles.enum';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { setFlash } from '../common/web/flash';

/**
 * Admin → Settings: the C2 approval thresholds, the C3 tolerances the triggers read, and
 * the integration status panel.
 */
@RequirePermission(PermissionEnum['users.manage'])
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly telegram: TelegramService,
    private readonly storage: StorageService,
  ) {}

  private async render(response: Response) {
    return response.render('admin/settings', {
      title: 'Settings',
      thresholds: await this.thresholds.findAll(),
      roles: [
        { id: RoleEnum.admin, label: 'Admin' },
        { id: RoleEnum.manager, label: 'Manager' },
        { id: RoleEnum.finance, label: 'Finance' },
        { id: RoleEnum.employee, label: 'Employee' },
      ],
      receiptTolerance: await this.settings.get('receipt_tolerance_pct', '0'),
      paymentTolerance: await this.settings.get('payment_tolerance_pct', '0'),
      integrations: {
        telegram: this.telegram.isConfigured,
        miniApp: Boolean(this.telegram.miniAppUrl),
        storage: this.storage.isConfigured,
        ocr: Boolean(process.env.OCR_SPACE_API_KEY),
      },
    });
  }

  @Get()
  show(@Res() response: Response) {
    return this.render(response);
  }

  /**
   * C2. Three states per role, and they must stay distinguishable:
   *   - "unlimited" ticked      → a row with a null limit;
   *   - an amount               → a row with that ceiling;
   *   - neither                 → no row, meaning the role cannot approve at all.
   * Treating a blank field as unlimited would silently hand approval rights to everyone.
   */
  @Post('thresholds')
  async saveThresholds(
    @Body() body: Record<string, string>,
    @Res() response: Response,
  ) {
    for (const role of [
      RoleEnum.admin,
      RoleEnum.manager,
      RoleEnum.finance,
      RoleEnum.employee,
    ]) {
      const unlimited = body[`unlimited_${role}`] === 'true';
      const raw = (body[`limit_${role}`] ?? '').trim();

      if (unlimited) {
        await this.thresholds.setLimit(role, null);
        continue;
      }

      if (raw === '') {
        await this.thresholds.removeLimit(role);
        continue;
      }

      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setFlash(response, 'error', 'Limits must be zero or more.');
        return response.redirect('/admin/settings');
      }

      await this.thresholds.setLimit(role, value.toFixed(4));
    }

    setFlash(response, 'success', 'Approval limits saved.');
    return response.redirect('/admin/settings');
  }

  /** C3: read by triggers T3 and T5, so they live in app_settings, not env. */
  @Post('tolerances')
  async saveTolerances(
    @Body() body: { receipt?: string; payment?: string },
    @Res() response: Response,
  ) {
    const parse = (raw?: string) => {
      const value = Number((raw ?? '0').trim());
      return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
    };

    const receipt = parse(body.receipt);
    const payment = parse(body.payment);

    if (receipt === null || payment === null) {
      setFlash(
        response,
        'error',
        'Tolerances are fractions between 0 and 1 — 0.05 means 5%.',
      );
      return response.redirect('/admin/settings');
    }

    await this.settings.set('receipt_tolerance_pct', String(receipt));
    await this.settings.set('payment_tolerance_pct', String(payment));

    setFlash(response, 'success', 'Tolerances saved.');
    return response.redirect('/admin/settings');
  }
}
