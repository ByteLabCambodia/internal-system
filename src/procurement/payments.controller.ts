import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { OcrService } from './ocr.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { CurrencyEnum, PaymentMethodEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { AccountsService } from '../accounting/accounts.service';
import { RatesService } from '../accounting/rates.service';
import { StorageService } from '../storage/storage.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';

/**
 * Recording a payment. Everything that makes it correct — the USD amount, the over-payment
 * guard, the expense-account resolution and the journal entry — happens in trigger T5.
 */
@Controller('accounting/payments')
export class PaymentsController {
  constructor(
    private readonly service: PaymentsService,
    private readonly orders: PurchaseOrdersService,
    private readonly accounts: AccountsService,
    private readonly rates: RatesService,
    private readonly ocr: OcrService,
    private readonly storage: StorageService,
    private readonly money: MoneyService,
    private readonly notifications: NotificationsService,
  ) {}

  private async formContext(values: object) {
    return {
      title: 'Record payment',
      orders: await this.orders.findPayable(),
      expenseAccounts: await this.accounts.findExpenseAccounts(),
      rates: await this.rates.currentRates(),
      currencies: Object.values(CurrencyEnum),
      methods: Object.values(PaymentMethodEnum),
      storageEnabled: this.storage.isConfigured,
      money: this.money,
      values,
      errors: {},
    };
  }

  @RequirePermission(PermissionEnum['payment.record'])
  @Get('new')
  async newForm(@Res() response: Response, @Query('poId') poId?: string) {
    return response.render('procurement/payment-form', {
      ...(await this.formContext(poId ? { poId } : {})),
    });
  }

  @RequirePermission(PermissionEnum['payment.record'])
  @Post()
  async record(@Body() body: RecordPaymentDto, @Res() response: Response) {
    const form = await validateForm(RecordPaymentDto, body);

    if (!form.ok) {
      return response.status(422).render('procurement/payment-form', {
        ...(await this.formContext(body)),
        errors: form.errors,
      });
    }

    try {
      const payment = await this.service.record(
        response.locals.currentUser,
        form.data,
      );

      await this.notifications.notify('payment_recorded', {
        paymentId: payment.id,
        number: payment.purchaseOrder?.poNumber ?? 'Direct expense',
        amount: this.money.format(payment.amountOriginal, payment.currency),
        actor: [
          response.locals.currentUser.firstName,
          response.locals.currentUser.lastName,
        ]
          .filter(Boolean)
          .join(' '),
      });

      setFlash(
        response,
        'success',
        `Payment of ${this.money.format(payment.amountOriginal, payment.currency)} recorded.`,
      );

      return response.redirect(
        payment.purchaseOrder
          ? `/purchase-orders/${payment.purchaseOrder.id}`
          : '/purchase-orders',
      );
    } catch (error) {
      return response.status(422).render('procurement/payment-form', {
        ...(await this.formContext(body)),
        alert: (error as Error).message,
      });
    }
  }

  /**
   * Called by the payment form once a receipt has landed in R2. Returns whatever OCR could
   * read so the form can autofill; missing fields come back as null, never as an error.
   */
  @RequirePermission(PermissionEnum['payment.record'])
  @Post('ocr')
  async runOcr(@Body('objectKey') objectKey: string) {
    if (!objectKey) return { ok: false, fields: null };

    const url = await this.storage.createViewUrl(objectKey);
    if (!url) return { ok: false, fields: null };

    return { ok: true, fields: await this.ocr.parseReceipt(url) };
  }
}
