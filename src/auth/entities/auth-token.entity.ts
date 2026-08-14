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

export enum AuthTokenPurposeEnum {
  invite = 'invite',
  reset = 'reset',
}

/**
 * One single-use token store for both invites (+7 days) and password resets (+1 hour).
 * The raw token is never stored — only its hash.
 */
@Entity({ name: 'auth_tokens' })
@Index('auth_tokens_user_idx', ['user', 'purpose'])
export class AuthTokenEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash: string;

  @Column({ name: 'purpose', type: 'text' })
  purpose: AuthTokenPurposeEnum;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
