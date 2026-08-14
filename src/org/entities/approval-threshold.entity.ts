import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { RoleEntity } from '../../roles/infrastructure/persistence/relational/entities/role.entity';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';

// C2: amount tiers for PR approval. null max_amount_usd = unlimited.
@Entity({ name: 'approval_thresholds' })
export class ApprovalThresholdEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RoleEntity, { eager: true })
  @JoinColumn({ name: 'role_id' })
  role: RoleEntity;

  @Column({
    name: 'max_amount_usd',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  maxAmountUsd: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;
}
