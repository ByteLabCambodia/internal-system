import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentEntity } from './entities/payment.entity';
import { RatesService } from '../accounting/rates.service';
import { ActivityService } from '../activity/activity.service';
import { CurrencyEnum } from '../common/enums';
import { User } from '../users/domain/user';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly repository: Repository<PaymentEntity>,
    private readonly rates: RatesService,
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
   * Recording a payment is mostly the database's job: trigger T5 derives amount_usd,
   * enforces the C3 over-payment guard, resolves the C1 expense account, writes the
   * balanced journal entry and rolls up the order's payment status. We insert, let it
   * raise if it must, and re-read the row.
   */
  async record(actor: User, dto: RecordPaymentDto): Promise<PaymentEntity> {
    if (!dto.poId && !dto.expenseAccountId) {
      throw new UnprocessableEntityException(
        'A payment with no purchase order needs an expense account.',
      );
    }

    const exchangeRate = await this.lockRate(dto.currency);

    let saved: PaymentEntity;
    try {
      saved = await this.repository.save(
        this.repository.create({
          purchaseOrder: dto.poId ? ({ id: dto.poId } as never) : null,
          amountOriginal: String(dto.amountOriginal),
          currency: dto.currency,
          exchangeRate,
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
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          receiptObjectKey: dto.receiptObjectKey ?? null,
          recordedBy: { id: Number(actor.id) } as never,
        }),
      );
    } catch (error) {
      // Surface the trigger's message (over-payment, missing accounts) as a form error.
      if (error instanceof QueryFailedError) {
        throw new UnprocessableEntityException(
          (error as QueryFailedError & { driverError?: { message?: string } })
            .driverError?.message ?? error.message,
        );
      }
      throw error;
    }

    await this.activity.log({
      entityType: dto.poId ? 'purchase_order' : 'payment',
      entityId: dto.poId ?? saved.id,
      action: 'payment_recorded',
      actorId: Number(actor.id),
      detail: {
        paymentId: saved.id,
        amountOriginal: dto.amountOriginal,
        currency: dto.currency,
        exchangeRate,
      },
    });

    return this.findOne(saved.id);
  }
}
