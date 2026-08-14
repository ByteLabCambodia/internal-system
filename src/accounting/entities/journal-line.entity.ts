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
import { AccountEntity } from './account.entity';
import { JournalEntryEntity } from './journal-entry.entity';
import { DepartmentEntity } from '../../org/entities/department.entity';
import { ProjectEntity } from '../../org/entities/project.entity';

/**
 * Double entry in USD. A line is one-sided (debit XOR credit, both non-negative) and every
 * entry must balance — enforced by the deferred constraint trigger T2, not here.
 */
@Entity({ name: 'journal_lines' })
export class JournalLineEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('journal_lines_entry_idx')
  @ManyToOne(() => JournalEntryEntity, (entry) => entry.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'entry_id' })
  entry: JournalEntryEntity;

  @Index('journal_lines_account_idx')
  @ManyToOne(() => AccountEntity)
  @JoinColumn({ name: 'account_id' })
  account: AccountEntity;

  @Column({
    name: 'debit_usd',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  debitUsd: string;

  @Column({
    name: 'credit_usd',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  creditUsd: string;

  @ManyToOne(() => DepartmentEntity, { nullable: true })
  @JoinColumn({ name: 'dimension_department_id' })
  department: DepartmentEntity | null;

  @ManyToOne(() => ProjectEntity, { nullable: true })
  @JoinColumn({ name: 'dimension_project_id' })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
