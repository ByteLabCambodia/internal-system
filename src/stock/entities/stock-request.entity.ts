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
import { StockPriorityEnum, StockRequestStatusEnum } from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { InventoryItemEntity } from '../../inventory/entities/inventory-item.entity';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';

@Entity({ name: 'stock_requests' })
export class StockRequestEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('stock_requests_requester_idx')
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'requester_id' })
  requester: UserEntity;

  @ManyToOne(() => InventoryItemEntity)
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItemEntity;

  @Column({
    name: 'qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
    transformer: numericTransformer,
  })
  qty: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: StockRequestStatusEnum,
    enumName: 'stock_request_status',
    default: StockRequestStatusEnum.pending,
  })
  status: StockRequestStatusEnum;

  @Column({
    name: 'priority',
    type: 'enum',
    enum: StockPriorityEnum,
    enumName: 'stock_priority',
    default: StockPriorityEnum.medium,
  })
  priority: StockPriorityEnum;

  @Column({ name: 'department', type: 'text', nullable: true })
  department: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy: UserEntity | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'fulfilled_by' })
  fulfilledBy: UserEntity | null;

  @Column({ name: 'fulfilled_at', type: 'timestamptz', nullable: true })
  fulfilledAt: Date | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
