import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { MovementReasonEnum } from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { InventoryItemEntity } from './inventory-item.entity';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';

/** Append-only ledger. Written ONLY by triggers T3/T4 and the adjustStock service method. */
@Entity({ name: 'stock_movements' })
@Index('stock_movements_item_idx', ['inventoryItem', 'createdAt'])
export class StockMovementEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => InventoryItemEntity)
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItemEntity;

  // +in / -out
  @Column({
    name: 'delta',
    type: 'numeric',
    precision: 18,
    scale: 4,
    transformer: numericTransformer,
  })
  delta: string;

  @Column({
    name: 'reason',
    type: 'enum',
    enum: MovementReasonEnum,
    enumName: 'movement_reason',
  })
  reason: MovementReasonEnum;

  @Column({ name: 'ref_table', type: 'text', nullable: true })
  refTable: string | null;

  @Column({ name: 'ref_id', type: 'int', nullable: true })
  refId: number | null;

  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 18,
    scale: 4,
    transformer: numericTransformer,
  })
  balanceAfter: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: UserEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
