import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { money, rate, timestamptz } from '../prisma/numeric';
import { PurchaseOrdersService } from './purchase-orders.service';
import { RatesService } from '../accounting/rates.service';
import { JournalService } from '../accounting/journal.service';
import { ActivityService } from '../activity/activity.service';
import { SettingsService } from '../settings/settings.service';
import { MoneyService } from '../common/money/money.service';
import { CurrencyEnum } from '../common/enums';
import { User } from '../users/domain/user';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly journal: JournalService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly settings: SettingsService,
    private readonly money: MoneyService,
    private readonly activity: ActivityService,
  ) {}

  private get payments() {
    return this.prisma.db.orm.public.Payment;
  }

  async listForOrder(poId: number) {
    return await this.payments
      .where({ poId })
      .include('recordedBy')
      .include('expenseAccount')
      .orderBy([(p) => p.paidAt.desc(), (p) => p.id.desc()])
      .all();
  }

  async findOne(id: number) {
    const payment = await this.payments
      .where({ id })
      .include('purchaseOrder')
      .include('expenseAccount')
      .include('recordedBy')
      .include('journalEntry')
      .first();

    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  private async lockRate(currency: `${CurrencyEnum}`): Promise<string> {
    const rate = await this.rates.getCurrentRate(currency);

    if (!rate) {
      throw new UnprocessableEntityException(
        `No exchange rate on file for ${currency}. Set today's rate before recording this payment.`,
      );
    }

    return rate;
  }

  /**
   * Records a payment, its cash-basis journal entry and the order's payment status in one
   * transaction. The order row is locked first, so concurrent payments against it are
   * checked one after another against everything already paid (C3).
   */
  async record(actor: User, dto: RecordPaymentDto) {
    if (!dto.poId && !dto.expenseAccountId) {
      throw new UnprocessableEntityException(
        'A payment with no purchase order needs an expense account.',
      );
    }

    const exchangeRate = await this.lockRate(dto.currency);
    const amountOriginal = this.money.round(dto.amountOriginal);
    const amountUsd = this.money.toUsd(amountOriginal, exchangeRate);
    const tolerance = await this.settings.numeric('payment_tolerance_pct');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const paymentId = await this.prisma.db.transaction(async (tx) => {
      const po = dto.poId
        ? await this.purchaseOrders.lockForPayment(tx, dto.poId)
        : null;

      if (dto.poId && !po) {
        throw new NotFoundException('Purchase order not found');
      }

      if (po) {
        this.assertNotOverpaid(
          po,
          await this.purchaseOrders.paidUsd(tx, po.id),
          amountUsd,
          tolerance,
        );
      }

      const payment = await tx.orm.public.Payment.create({
        poId: po?.id ?? null,
        amountOriginal: money(amountOriginal),
        currency: dto.currency,
        exchangeRate: rate(exchangeRate),
        amountUsd: money(amountUsd),
        expenseAccountId: dto.expenseAccountId || null,
        method: dto.method ?? null,
        bankAccount: dto.bankAccount ?? null,
        reference: dto.reference ?? null,
        trxId: dto.trxId ?? null,
        sender: dto.sender ?? null,
        transferTo: dto.transferTo ?? null,
        remark: dto.remark ?? null,
        paidAt: timestamptz(paidAt),
        receiptObjectKey: dto.receiptObjectKey ?? null,
        recordedById: Number(actor.id),
      });

      const journalEntryId = await this.journal.postPayment(tx, {
        id: payment.id,
        paidAt,
        memo: po ? `Payment for ${po.poNumber}` : 'Payment (direct expense)',
        currency: dto.currency,
        exchangeRate,
        amountUsd,
        expenseAccountId: po?.expenseAccountId ?? dto.expenseAccountId ?? null,
        departmentId: po?.departmentId ?? null,
        projectId: po?.projectId ?? null,
        actorId: Number(actor.id),
      });

      await tx.orm.public.Payment.where({ id: payment.id }).update({
        journalEntryId,
      });

      if (po) await this.purchaseOrders.rollUpPaymentStatus(tx, po);

      return payment.id;
    });

    await this.activity.log({
      entityType: dto.poId ? 'purchase_order' : 'payment',
      entityId: dto.poId ?? paymentId,
      action: 'payment_recorded',
      actorId: Number(actor.id),
      detail: {
        paymentId,
        amountOriginal: dto.amountOriginal,
        currency: dto.currency,
        exchangeRate,
      },
    });

    return this.findOne(paymentId);
  }

  /** Over-payment is compared in USD, against the order total plus the tolerance. */
  private assertNotOverpaid(
    po: { poNumber: string; totalUsd: string },
    alreadyPaid: string,
    amountUsd: string,
    tolerance: Decimal,
  ): void {
    const paid = new Decimal(alreadyPaid);
    const total = new Decimal(po.totalUsd);
    const after = paid.plus(amountUsd);

    if (after.lessThanOrEqualTo(total.times(tolerance.plus(1)))) return;

    const usd = (value: Decimal.Value) =>
      new Decimal(value).toFixed(2, Decimal.ROUND_HALF_UP);

    throw new UnprocessableEntityException(
      paid.isZero()
        ? `Cannot record this payment: ${po.poNumber} has a total of $${usd(total)} USD, and this $${usd(amountUsd)} USD payment exceeds it.`
        : `Cannot record this payment: ${po.poNumber} has a total of $${usd(total)} USD. $${usd(paid)} USD is already paid, and this $${usd(amountUsd)} USD payment would bring the total paid to $${usd(after)} USD.`,
    );
  }
}
