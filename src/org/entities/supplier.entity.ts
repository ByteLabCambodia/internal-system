import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';

// C4: supplier master, replaces the free-text purchase_orders.supplier
@Entity({ name: 'suppliers' })
export class SupplierEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'name', type: 'text', unique: true })
  name: string;

  @Column({ name: 'contact_name', type: 'text', nullable: true })
  contactName: string | null;

  @Column({ name: 'phone', type: 'text', nullable: true })
  phone: string | null;

  @Column({ name: 'email', type: 'text', nullable: true })
  email: string | null;

  @Column({ name: 'address', type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'bank_account', type: 'text', nullable: true })
  bankAccount: string | null;

  @Column({ name: 'payment_terms_days', type: 'int', nullable: true })
  paymentTermsDays: number | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
