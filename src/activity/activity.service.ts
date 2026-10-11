import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toDate } from '../prisma/dates';

export type ActivityEntityType =
  | 'purchase_request'
  | 'purchase_order'
  | 'payment'
  | 'stock_request'
  | 'inventory_claim'
  | 'inventory_item'
  | 'user'
  | 'supplier'
  | 'customer'
  | 'sales_document';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get events() {
    return this.prisma.db.orm.public.ActivityEvent;
  }

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
      await this.events.create({
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        actorId: params.actorId ?? null,
        // Round-trip so the column gets plain JSON (undefined values dropped), as before.
        detail: params.detail
          ? JSON.parse(JSON.stringify(params.detail))
          : null,
      });
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
    const rows = await this.events
      .where({ entityType, entityId })
      .include('actor')
      .orderBy([(e) => e.createdAt.asc(), (e) => e.id.asc()])
      .all();

    return rows.map((row) => ({
      action: row.action,
      actorName: row.actor
        ? [row.actor.firstName, row.actor.lastName].filter(Boolean).join(' ')
        : null,
      createdAt: toDate(row.createdAt),
    }));
  }
}
