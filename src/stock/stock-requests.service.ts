import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { money, timestamptz } from '../prisma/numeric';
import { MovementReasonEnum, StockRequestStatusEnum } from '../common/enums';
import {
  InventoryItemRow,
  InventoryService,
} from '../inventory/inventory.service';
import { PurchaseRequestsService } from '../procurement/purchase-requests.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { PermissionsService } from '../permissions/permissions.service';
import { User } from '../users/domain/user';
import { CreateStockRequestDto } from './dto/create-stock-request.dto';

export type StockRequestFilters = {
  status?: StockRequestStatusEnum;
  page: number;
  limit: number;
};

@Injectable()
export class StockRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly purchaseRequests: PurchaseRequestsService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionsService,
  ) {}

  private get requests() {
    return this.prisma.db.orm.public.StockRequest;
  }

  /** Own requests, or every request for manager/finance/admin. */
  private scoped(actor: User) {
    return this.permissions.seesAllRows(actor)
      ? this.requests.where({})
      : this.requests.where({ requesterId: Number(actor.id) });
  }

  async list(actor: User, filters: StockRequestFilters) {
    const requests = filters.status
      ? this.scoped(actor).where({ status: filters.status })
      : this.scoped(actor);

    const [rows, total] = await Promise.all([
      requests
        .include('inventoryItem')
        .include('requester')
        .orderBy([(r) => r.createdAt.desc(), (r) => r.id.desc()])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      requests.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findOneForActor(actor: User, id: number) {
    const request = await this.scoped(actor)
      .where({ id })
      .include('inventoryItem')
      .include('requester')
      .include('approvedBy')
      .include('fulfilledBy')
      .first();

    if (!request) throw new NotFoundException('Stock request not found');

    return request;
  }

  async create(actor: User, dto: CreateStockRequestDto) {
    const request = await this.requests.create({
      requesterId: Number(actor.id),
      inventoryItemId: dto.inventoryItemId,
      qty: money(String(dto.qty)),
      priority: dto.priority,
      department: dto.department ?? null,
      note: dto.note ?? null,
    });

    await this.activity.log({
      entityType: 'stock_request',
      entityId: request.id,
      action: 'created',
      actorId: Number(actor.id),
      detail: { qty: dto.qty, priority: dto.priority },
    });

    return request;
  }

  async approve(actor: User, id: number): Promise<void> {
    const request = await this.requests.where({ id }).first();
    if (!request) throw new NotFoundException('Stock request not found');

    if (request.status !== StockRequestStatusEnum.pending) {
      throw new UnprocessableEntityException(
        `This request is already ${request.status}.`,
      );
    }

    await this.requests.where({ id }).update({
      status: StockRequestStatusEnum.approved,
      approvedById: Number(actor.id),
      approvedAt: timestamptz(new Date()),
    });

    await this.activity.log({
      entityType: 'stock_request',
      entityId: id,
      action: 'approved',
      actorId: Number(actor.id),
    });
  }

  /**
   * Fulfilment hands the stock out: locks the request (so it is fulfilled once), moves the
   * stock out through the locked item row, refuses to go below zero and appends the ledger
   * row. If that lands the item at or below its reorder point, a draft reorder PR is raised
   * in the same transaction and managers are notified once it commits.
   */
  async fulfil(actor: User, id: number): Promise<void> {
    const reorder = await this.prisma.db.transaction(async (tx) => {
      const requests = tx.orm.public.StockRequest;
      const request = await requests.where({ id }).forUpdate().first();

      if (!request) throw new NotFoundException('Stock request not found');

      if (request.status === StockRequestStatusEnum.fulfilled) {
        throw new UnprocessableEntityException(
          'This request has already been fulfilled.',
        );
      }
      if (request.status === StockRequestStatusEnum.rejected) {
        throw new UnprocessableEntityException(
          'A rejected request cannot be fulfilled.',
        );
      }

      const { item, balanceAfter } = await this.inventory.applyMovement(tx, {
        itemId: request.inventoryItemId,
        delta: new Decimal(request.qty).negated(),
        reason: MovementReasonEnum.stock_request,
        refTable: 'stock_requests',
        refId: request.id,
        actorId: Number(actor.id),
        onNegative: (locked) =>
          `insufficient stock for ${locked.sku}: ${new Decimal(locked.stockQty).toFixed(4)} on hand, ${new Decimal(request.qty).toFixed(4)} requested`,
      });

      await requests.where({ id }).update({
        status: StockRequestStatusEnum.fulfilled,
        fulfilledById: Number(actor.id),
        fulfilledAt: request.fulfilledAt ?? timestamptz(new Date()),
      });

      if (!this.needsReorder(item)) return null;

      const purchaseRequestId = await this.purchaseRequests.createReorderDraft(
        tx,
        request.requesterId,
        item,
      );

      return { item, balanceAfter, purchaseRequestId };
    });

    await this.activity.log({
      entityType: 'stock_request',
      entityId: id,
      action: 'fulfilled',
      actorId: Number(actor.id),
    });

    if (reorder) {
      // Keys match what the dashboard reads from the payload.
      await this.notifications.notify('stock_below_reorder', {
        inventory_item_id: reorder.item.id,
        sku: reorder.item.sku,
        name: reorder.item.name,
        balance_after: reorder.balanceAfter,
        reorder_point: reorder.item.reorderPoint,
        purchase_request_id: reorder.purchaseRequestId,
      });
    }
  }

  private needsReorder(item: InventoryItemRow): boolean {
    return (
      new Decimal(item.stockQty).lessThanOrEqualTo(item.reorderPoint) &&
      new Decimal(item.reorderQty).greaterThan(0)
    );
  }

  async reject(actor: User, id: number): Promise<void> {
    const request = await this.requests.where({ id }).first();
    if (!request) throw new NotFoundException('Stock request not found');

    if (request.status === StockRequestStatusEnum.fulfilled) {
      throw new UnprocessableEntityException(
        'A fulfilled request cannot be rejected.',
      );
    }

    await this.requests.where({ id }).update({
      status: StockRequestStatusEnum.rejected,
    });

    await this.activity.log({
      entityType: 'stock_request',
      entityId: id,
      action: 'rejected',
      actorId: Number(actor.id),
    });
  }
}
