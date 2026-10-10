import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';

/**
 * Key/value settings Admin → Settings edits at runtime, such as the C3 tolerances. Values
 * are stored as text and cast where used; see SettingsService.numeric().
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
