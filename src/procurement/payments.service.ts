import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { PaymentEntity } from './entities/payment.entity';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
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
    @InjectRepository(PaymentEntity)
    private readonly repository: Repository<PaymentEntity>,
    private readonly dataSource: DataSource,
    private readonly rates: RatesService,
    private readonly journal: JournalService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly settings: SettingsService,
    private readonly money: MoneyService,
    private readonly activity: ActivityService,
  ) {}

  listForOrder(poId: number): Promise<PaymentEntity[]> {
    return this.repository.find({
      where: { purchaseOrder: { id: poId } },
      relations: ['recordedBy', 'expenseAccount'],
      order: { paidAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<PaymentEntity> {
    const payment = await this.repository.findOne({
      where: { id },
      relations: [
        'purchaseOrder',
        'expenseAccount',
        'recordedBy',
        'journalEntry',
      ],
    });

    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  private async lockRate(currency: CurrencyEnum): Promise<string> {
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
  async record(actor: User, dto: RecordPaymentDto): Promise<PaymentEntity> {
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

    const paymentId = await this.dataSource.transaction(async (manager) => {
      const po = dto.poId
        ? await this.purchaseOrders.lockForPayment(manager, dto.poId)
        : null;

      if (dto.poId && !po) {
        throw new NotFoundException('Purchase order not found');
      }

      if (po) {
        this.assertNotOverpaid(
          po,
          await this.purchaseOrders.paidUsd(manager, po.id),
          amountUsd,
          tolerance,
        );
      }

      const payment = await manager.save(
        manager.create(PaymentEntity, {
          purchaseOrder: po ? ({ id: po.id } as never) : null,
          amountOriginal,
          currency: dto.currency,
          exchangeRate,
          amountUsd,
          expenseAccount: dto.expenseAccountId
            ? ({ id: dto.expenseAccountId } as never)
            : null,
          method: dto.method ?? null,
          bankAccount: dto.bankAccount ?? null,
          reference: dto.reference ?? null,
          trxId: dto.trxId ?? null,
          sender: dto.sender ?? null,
          transferTo: dto.transferTo ?? null,
          remark: dto.remark ?? null,
          paidAt,
          receiptObjectKey: dto.receiptObjectKey ?? null,
          recordedBy: { id: Number(actor.id) } as never,
        }),
      );

      const journalEntryId = await this.journal.postPayment(manager, {
        id: payment.id,
        paidAt,
        memo: po ? `Payment for ${po.poNumber}` : 'Payment (direct expense)',
        currency: dto.currency,
        exchangeRate,
        amountUsd,
        expenseAccountId:
          po?.expenseAccount?.id ?? dto.expenseAccountId ?? null,
        departmentId: po?.department?.id ?? null,
        projectId: po?.project?.id ?? null,
        actorId: Number(actor.id),
      });

      await manager.update(PaymentEntity, payment.id, {
        journalEntry: { id: journalEntryId } as never,
      });

      if (po) await this.purchaseOrders.rollUpPaymentStatus(manager, po);

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
    po: PurchaseOrderEntity,
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
