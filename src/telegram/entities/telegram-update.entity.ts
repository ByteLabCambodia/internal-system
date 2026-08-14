import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';

/** Webhook idempotency: an update_id already present has been processed. */
@Entity({ name: 'telegram_updates' })
export class TelegramUpdateEntity extends EntityRelationalHelper {
  @PrimaryColumn({ name: 'update_id', type: 'bigint' })
  updateId: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
