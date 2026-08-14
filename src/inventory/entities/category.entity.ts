import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { AccountEntity } from '../../accounting/entities/account.entity';

@Entity({ name: 'categories' })
export class CategoryEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'name', type: 'text', unique: true })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  // C1: the GL account a PO built from this category debits
  @ManyToOne(() => AccountEntity, { nullable: true })
  @JoinColumn({ name: 'expense_account_id' })
  expenseAccount: AccountEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
