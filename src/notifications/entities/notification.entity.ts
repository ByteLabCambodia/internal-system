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

@Entity({ name: 'notifications' })
@Index('notifications_user_idx', ['user', 'read'])
export class NotificationEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'event', type: 'text' })
  event: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  @Column({ name: 'telegram_sent', type: 'boolean', default: false })
  telegramSent: boolean;

  @Column({ name: 'read', type: 'boolean', default: false })
  read: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
