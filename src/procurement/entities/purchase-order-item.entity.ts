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
import { PurchaseOrderEntity } from './purchase-order.entity';

@Entity({ name: 'purchase_order_items' })
export class PurchaseOrderItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('purchase_order_items_po_idx')
  @ManyToOne(() => PurchaseOrderEntity, (po) => po.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'po_id' })
  purchaseOrder: PurchaseOrderEntity;

  @ManyToOne(() => InventoryItemEntity, { nullable: true })
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItemEntity | null;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({
    name: 'qty_ordered',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 1,
    transformer: numericTransformer,
  })
  qtyOrdered: string;

  // maintained by trigger T3 on claim confirmation
  @Column({
    name: 'qty_claimed',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyClaimed: string;

  @Column({
    name: 'unit_price_original',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitPriceOriginal: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
