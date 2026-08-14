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
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';

@Entity({ name: 'activity_events' })
@Index('activity_events_entity_idx', ['entityType', 'entityId', 'createdAt'])
export class ActivityEventEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  // purchase_request | purchase_order | payment | stock_request | ...
  @Column({ name: 'entity_type', type: 'text' })
  entityType: string;

  @Column({ name: 'entity_id', type: 'int' })
  entityId: number;

  // created | submitted | approved | rejected | converted | cancelled
  // | payment_recorded | fulfilled | ...
  @Column({ name: 'action', type: 'text' })
  action: string;

  @Index('activity_events_actor_idx')
  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor: UserEntity | null;

  @Column({ name: 'detail', type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
