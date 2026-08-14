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
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { InventoryItemEntity } from '../../inventory/entities/inventory-item.entity';
import { PurchaseRequestEntity } from './purchase-request.entity';

@Entity({ name: 'purchase_request_items' })
export class PurchaseRequestItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('purchase_request_items_pr_idx')
  @ManyToOne(() => PurchaseRequestEntity, (pr) => pr.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'pr_id' })
  purchaseRequest: PurchaseRequestEntity;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({
    name: 'qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 1,
    transformer: numericTransformer,
  })
  qty: string;

  @Column({
    name: 'unit_price_original',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitPriceOriginal: string;

  @ManyToOne(() => InventoryItemEntity, { nullable: true })
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItemEntity | null;

  @Column({ name: 'category', type: 'text', nullable: true })
  category: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
