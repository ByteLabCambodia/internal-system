import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import {
  CurrencyEnum,
  PaymentStatusEnum,
  PoStatusEnum,
  PoTypeEnum,
} from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { AccountEntity } from '../../accounting/entities/account.entity';
import { DepartmentEntity } from '../../org/entities/department.entity';
import { ProjectEntity } from '../../org/entities/project.entity';
import { SupplierEntity } from '../../org/entities/supplier.entity';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';
import { PurchaseRequestEntity } from './purchase-request.entity';
import { PurchaseOrderItemEntity } from './purchase-order-item.entity';

@Entity({ name: 'purchase_orders' })
export class PurchaseOrderEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  // defaulted in the DB: 'PO-' || lpad(nextval('po_number_seq'), 4, '0')
  @Column({ name: 'po_number', type: 'text' })
  poNumber: string;

  @ManyToOne(() => PurchaseRequestEntity, { nullable: true })
  @JoinColumn({ name: 'pr_id' })
  purchaseRequest: PurchaseRequestEntity | null;

  @Column({
    name: 'type',
    type: 'enum',
    enum: PoTypeEnum,
    enumName: 'po_type',
    default: PoTypeEnum.online,
  })
  type: PoTypeEnum;

  // legacy free text, kept for backfill — new records use supplier (C4)
  @Column({ name: 'supplier', type: 'text', nullable: true })
  supplierName: string | null;

  @ManyToOne(() => SupplierEntity, { nullable: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier: SupplierEntity | null;

  // C1: resolved at PO creation, overridable by finance
  @ManyToOne(() => AccountEntity, { nullable: true })
  @JoinColumn({ name: 'expense_account_id' })
  expenseAccount: AccountEntity | null;

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

  @Index('purchase_orders_status_idx')
  @Column({
    name: 'status',
    type: 'enum',
    enum: PoStatusEnum,
    enumName: 'po_status',
    default: PoStatusEnum.open,
  })
  status: PoStatusEnum;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatusEnum,
    enumName: 'payment_status',
    default: PaymentStatusEnum.unpaid,
  })
  paymentStatus: PaymentStatusEnum;

  @Column({
    name: 'total_original',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  totalOriginal: string;

  // derived by trigger T1 — never write this directly
  @Column({
    name: 'total_usd',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  totalUsd: string;

  @ManyToOne(() => DepartmentEntity, { nullable: true })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;

  @ManyToOne(() => ProjectEntity, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: UserEntity | null;

  @OneToMany(() => PurchaseOrderItemEntity, (item) => item.purchaseOrder)
  items: PurchaseOrderItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
