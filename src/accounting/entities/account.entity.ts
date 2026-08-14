import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { AccountTypeEnum } from '../../common/enums';

@Entity({ name: 'accounts' })
export class AccountEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'code', type: 'text', unique: true })
  code: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: AccountTypeEnum,
    enumName: 'account_type',
  })
  type: AccountTypeEnum;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
