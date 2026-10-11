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
import { COMPANY_SETTINGS } from '../sales/sales.service';
import { SalesDocLanguageEnum } from '../common/enums';

/**
 * Admin → Settings: the C2 approval thresholds, the C3 receipt/payment tolerances, and
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
      company: Object.fromEntries(
        await Promise.all(
          Object.entries(COMPANY_SETTINGS).map(
            async ([key, fallback]) =>
              [key, await this.settings.get(key, fallback)] as const,
          ),
        ),
      ),
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

  /** C3: read by claim confirmation and payment recording; editable without a deploy. */
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

  /** Seller details and the default VAT rate printed on quotations, invoices and receipts. */
  @Post('company')
  async saveCompany(
    @Body() body: Record<string, string>,
    @Res() response: Response,
  ) {
    const vat = Number((body.sales_vat_rate ?? '').trim() || '0');
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) {
      setFlash(response, 'error', 'VAT rate is a percentage from 0 to 100.');
      return response.redirect('/admin/settings');
    }

    if (
      !Object.values(SalesDocLanguageEnum).includes(
        body.sales_default_language as SalesDocLanguageEnum,
      )
    ) {
      setFlash(response, 'error', 'Choose a default document language.');
      return response.redirect('/admin/settings');
    }

    for (const key of Object.keys(COMPANY_SETTINGS)) {
      await this.settings.set(key, (body[key] ?? '').trim());
    }

    setFlash(response, 'success', 'Company details saved.');
    return response.redirect('/admin/settings');
  }
}
