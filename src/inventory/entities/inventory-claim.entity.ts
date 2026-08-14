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
import { ClaimStatusEnum } from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { InventoryItemEntity } from './inventory-item.entity';
import { PurchaseOrderEntity } from '../../procurement/entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from '../../procurement/entities/purchase-order-item.entity';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';

@Entity({ name: 'inventory_claims' })
export class InventoryClaimEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('inventory_claims_po_idx')
  @ManyToOne(() => PurchaseOrderEntity, { nullable: true })
  @JoinColumn({ name: 'po_id' })
  purchaseOrder: PurchaseOrderEntity | null;

  @ManyToOne(() => PurchaseOrderItemEntity, { nullable: true })
  @JoinColumn({ name: 'po_item_id' })
  purchaseOrderItem: PurchaseOrderItemEntity | null;

  @ManyToOne(() => InventoryItemEntity)
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItemEntity;

  @Column({
    name: 'qty_claimed',
    type: 'numeric',
    precision: 18,
    scale: 4,
    transformer: numericTransformer,
  })
  qtyClaimed: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ClaimStatusEnum,
    enumName: 'claim_status',
    default: ClaimStatusEnum.pending,
  })
  status: ClaimStatusEnum;

  @Column({ name: 'receipt_object_key', type: 'text', nullable: true })
  receiptObjectKey: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'claimed_by' })
  claimedBy: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'confirmed_by' })
  confirmedBy: UserEntity | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
