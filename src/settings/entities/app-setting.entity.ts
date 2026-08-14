import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';

/**
 * Key/value settings that the DB triggers themselves must read (a trigger cannot see the
 * app's env), plus anything Admin → Settings edits. Values are stored as text and cast
 * where used; see app_setting_numeric() in the trigger migration.
 */
@Entity({ name: 'app_settings' })
export class AppSettingEntity extends EntityRelationalHelper {
  @PrimaryColumn({ name: 'key', type: 'text' })
  key: string;

  @Column({ name: 'value', type: 'text' })
  value: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
