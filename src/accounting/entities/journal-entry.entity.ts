import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { CurrencyEnum, JournalSourceEnum } from '../../common/enums';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';
import { JournalLineEntity } from './journal-line.entity';

@Entity({ name: 'journal_entries' })
export class JournalEntryEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'entry_date', type: 'date', default: () => 'current_date' })
  entryDate: string;

  @Column({ name: 'memo', type: 'text', nullable: true })
  memo: string | null;

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

  @Column({
    name: 'source',
    type: 'enum',
    enum: JournalSourceEnum,
    enumName: 'journal_source',
  })
  source: JournalSourceEnum;

  @Column({ name: 'source_ref', type: 'int', nullable: true })
  sourceRef: number | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: UserEntity | null;

  @OneToMany(() => JournalLineEntity, (line) => line.entry)
  lines: JournalLineEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
