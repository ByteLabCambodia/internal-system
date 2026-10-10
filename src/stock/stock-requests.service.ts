import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { StockRequestEntity } from './entities/stock-request.entity';
import { MovementReasonEnum, StockRequestStatusEnum } from '../common/enums';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryItemEntity } from '../inventory/entities/inventory-item.entity';
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
    @InjectRepository(StockRequestEntity)
    private readonly repository: Repository<StockRequestEntity>,
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
    private readonly purchaseRequests: PurchaseRequestsService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Own requests, or every request for manager/finance/admin. */
  private applyScope(
    query: ReturnType<Repository<StockRequestEntity>['createQueryBuilder']>,
    actor: User,
  ) {
    if (!this.permissions.seesAllRows(actor)) {
      query.andWhere('request.requester_id = :actorId', { actorId: actor.id });
    }
    return query;
  }

  async list(
    actor: User,
    filters: StockRequestFilters,
  ): Promise<{ rows: StockRequestEntity[]; count: number }> {
    const query = this.repository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.inventoryItem', 'item')
      .leftJoinAndSelect('request.requester', 'requester');

    this.applyScope(query, actor);

    if (filters.status) {
      query.andWhere('request.status = :status', { status: filters.status });
    }

    const [rows, count] = await query
      .orderBy('request.createdAt', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { rows, count };
  }

  async findOneForActor(actor: User, id: number): Promise<StockRequestEntity> {
    const query = this.repository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.inventoryItem', 'item')
      .leftJoinAndSelect('request.requester', 'requester')
      .leftJoinAndSelect('request.approvedBy', 'approvedBy')
      .leftJoinAndSelect('request.fulfilledBy', 'fulfilledBy')
      .where('request.id = :id', { id });

    this.applyScope(query, actor);

    const request = await query.getOne();
    if (!request) throw new NotFoundException('Stock request not found');

    return request;
  }

  async create(
    actor: User,
    dto: CreateStockRequestDto,
  ): Promise<StockRequestEntity> {
    const request = await this.repository.save(
      this.repository.create({
        requester: { id: Number(actor.id) } as never,
        inventoryItem: { id: dto.inventoryItemId } as never,
        qty: String(dto.qty),
        priority: dto.priority,
        department: dto.department ?? null,
        note: dto.note ?? null,
      }),
    );

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
    const request = await this.repository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Stock request not found');

    if (request.status !== StockRequestStatusEnum.pending) {
      throw new UnprocessableEntityException(
        `This request is already ${request.status}.`,
      );
    }

    await this.repository.update(id, {
      status: StockRequestStatusEnum.approved,
      approvedBy: { id: Number(actor.id) } as never,
      approvedAt: new Date(),
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
    const reorder = await this.dataSource.transaction(async (manager) => {
      const request = await manager
        .createQueryBuilder(StockRequestEntity, 'request')
        .innerJoinAndSelect('request.requester', 'requester')
        .innerJoinAndSelect('request.inventoryItem', 'item')
        .setLock('pessimistic_write', undefined, ['request'])
        .where('request.id = :id', { id })
        .getOne();

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

      const { item, balanceAfter } = await this.inventory.applyMovement(
        manager,
        {
          itemId: request.inventoryItem.id,
          delta: new Decimal(request.qty).negated(),
          reason: MovementReasonEnum.stock_request,
          refTable: 'stock_requests',
          refId: request.id,
          actorId: Number(actor.id),
          onNegative: (locked) =>
            `insufficient stock for ${locked.sku}: ${new Decimal(locked.stockQty).toFixed(4)} on hand, ${new Decimal(request.qty).toFixed(4)} requested`,
        },
      );

      await manager.update(StockRequestEntity, id, {
        status: StockRequestStatusEnum.fulfilled,
        fulfilledBy: { id: Number(actor.id) } as never,
        fulfilledAt: request.fulfilledAt ?? new Date(),
      });

      if (!this.needsReorder(item)) return null;

      const purchaseRequestId = await this.purchaseRequests.createReorderDraft(
        manager,
        request.requester.id,
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

  private needsReorder(item: InventoryItemEntity): boolean {
    return (
      new Decimal(item.stockQty).lessThanOrEqualTo(item.reorderPoint) &&
      new Decimal(item.reorderQty).greaterThan(0)
    );
  }

  async reject(actor: User, id: number): Promise<void> {
    const request = await this.repository.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Stock request not found');

    if (request.status === StockRequestStatusEnum.fulfilled) {
      throw new UnprocessableEntityException(
        'A fulfilled request cannot be rejected.',
      );
    }

    await this.repository.update(id, {
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
