import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';

@Entity({ name: 'inventory_items' })
export class InventoryItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'sku', type: 'text', unique: true })
  sku: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'category', type: 'text', nullable: true })
  category: string | null;

  @Column({ name: 'unit', type: 'text', default: 'pcs' })
  unit: string;

  @Column({
    name: 'stock_qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  stockQty: string;

  @Column({
    name: 'reorder_point',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  reorderPoint: string;

  @Column({
    name: 'reorder_qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  reorderQty: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
