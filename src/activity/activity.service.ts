import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityEventEntity } from './entities/activity-event.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';

export type ActivityEntityType =
  | 'purchase_request'
  | 'purchase_order'
  | 'payment'
  | 'stock_request'
  | 'inventory_claim'
  | 'inventory_item'
  | 'user'
  | 'supplier';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectRepository(ActivityEventEntity)
    private readonly repository: Repository<ActivityEventEntity>,
  ) {}

  /**
   * Best-effort audit write. A failure here is logged and swallowed — the activity log must
   * never roll back the business mutation it is describing.
   */
  async log(params: {
    entityType: ActivityEntityType;
    entityId: number;
    action: string;
    actorId?: number | null;
    detail?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      let actor: UserEntity | null = null;
      if (params.actorId) {
        actor = new UserEntity();
        actor.id = params.actorId;
      }

      await this.repository.save(
        this.repository.create({
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          actor,
          detail: params.detail ?? null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to record activity ${params.action} on ${params.entityType}#${params.entityId}: ${error}`,
      );
    }
  }

  /** Timeline for a detail page, newest last so it reads top to bottom. */
  async timelineFor(
    entityType: ActivityEntityType,
    entityId: number,
  ): Promise<{ action: string; actorName: string | null; createdAt: Date }[]> {
    const rows = await this.repository.find({
      where: { entityType, entityId },
      relations: ['actor'],
      order: { createdAt: 'ASC' },
    });

    return rows.map((row) => ({
      action: row.action,
      actorName: row.actor
        ? [row.actor.firstName, row.actor.lastName].filter(Boolean).join(' ')
        : null,
      createdAt: row.createdAt,
    }));
  }
}
