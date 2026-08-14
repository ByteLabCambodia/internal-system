import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { RoleEntity } from '../../../../../roles/infrastructure/persistence/relational/entities/role.entity';

import { AuthProvidersEnum } from '../../../../../auth/auth-providers.enum';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'user',
})
export class UserEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  // For "string | null" we need to use String type.
  // More info: https://github.com/typeorm/typeorm/issues/2567
  @Column({ type: String, unique: true, nullable: true })
  email: string | null;

  // Nullable on purpose: an invited user has none until they set one, and "no password"
  // must never authenticate.
  @Column({ nullable: true })
  password?: string;

  @Column({ default: AuthProvidersEnum.email })
  provider: string;

  @Index()
  @Column({ type: String, nullable: true })
  socialId?: string | null;

  @Index()
  @Column({ type: String, nullable: true })
  firstName: string | null;

  @Index()
  @Column({ type: String, nullable: true })
  lastName: string | null;

  @OneToOne(() => FileEntity, {
    eager: true,
  })
  @JoinColumn()
  photo?: FileEntity | null;

  @ManyToOne(() => RoleEntity, {
    eager: true,
  })
  role?: RoleEntity | null;

  @Column({ type: Boolean, default: true })
  active: boolean;

  // Set when an admin sets a password directly; cleared once the user changes it.
  @Column({ name: 'must_change_password', type: Boolean, default: false })
  mustChangePassword: boolean;

  @Column({ name: 'telegram_id', type: 'bigint', unique: true, nullable: true })
  telegramId: string | null;

  @Column({ name: 'telegram_username', type: String, nullable: true })
  telegramUsername: string | null;

  @Column({ name: 'telegram_link_token', type: String, nullable: true })
  telegramLinkToken: string | null;

  @Column({
    name: 'telegram_link_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  telegramLinkExpiresAt: Date | null;

  @Column({ type: String, nullable: true })
  department: string | null;

  @Column({ name: 'payment_link', type: String, nullable: true })
  paymentLink: string | null;

  @Column({ name: 'payment_qr_object_key', type: String, nullable: true })
  paymentQrObjectKey: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
