import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { CurrencyEnum, PaymentMethodEnum } from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { AccountEntity } from '../../accounting/entities/account.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';
import { PurchaseOrderEntity } from './purchase-order.entity';

@Entity({ name: 'payments' })
export class PaymentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  // nullable: a standalone direct expense has no PO
  @Index('payments_po_idx')
  @ManyToOne(() => PurchaseOrderEntity, { nullable: true })
  @JoinColumn({ name: 'po_id' })
  purchaseOrder: PurchaseOrderEntity | null;

  @Column({
    name: 'amount_original',
    type: 'numeric',
    precision: 18,
    scale: 4,
    transformer: numericTransformer,
  })
  amountOriginal: string;

  @Column({
    name: 'currency',
    type: 'enum',
    enum: CurrencyEnum,
    enumName: 'currency',
    default: CurrencyEnum.USD,
  })
  currency: CurrencyEnum;

  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 1,
    transformer: numericTransformer,
  })
  exchangeRate: string;

  // derived by trigger T1 — never write this directly
  @Column({
    name: 'amount_usd',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  amountUsd: string;

  // C1: required when po_id is null
  @ManyToOne(() => AccountEntity, { nullable: true })
  @JoinColumn({ name: 'expense_account_id' })
  expenseAccount: AccountEntity | null;

  @Column({
    name: 'method',
    type: 'enum',
    enum: PaymentMethodEnum,
    enumName: 'payment_method',
    nullable: true,
  })
  method: PaymentMethodEnum | null;

  @Column({ name: 'bank_account', type: 'text', nullable: true })
  bankAccount: string | null;

  @Column({ name: 'reference', type: 'text', nullable: true })
  reference: string | null;

  @Column({ name: 'trx_id', type: 'text', nullable: true })
  trxId: string | null;

  @Column({ name: 'sender', type: 'text', nullable: true })
  sender: string | null;

  @Column({ name: 'transfer_to', type: 'text', nullable: true })
  transferTo: string | null;

  @Column({ name: 'remark', type: 'text', nullable: true })
  remark: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', default: () => 'now()' })
  paidAt: Date;

  @Column({ name: 'receipt_object_key', type: 'text', nullable: true })
  receiptObjectKey: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'recorded_by' })
  recordedBy: UserEntity | null;

  // set by trigger T5
  @ManyToOne(() => JournalEntryEntity, { nullable: true })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntryEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
