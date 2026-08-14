import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { InventoryItemEntity } from './entities/inventory-item.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { MovementReasonEnum } from '../common/enums';
import { ActivityService } from '../activity/activity.service';
import { User } from '../users/domain/user';
import { InventoryItemDto } from './dto/inventory-item.dto';

export type ItemListFilters = {
  search?: string;
  lowStock?: boolean;
  page: number;
  limit: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
};

/** URL sort key → entity property; see the note in purchase-requests.service.ts. */
const SORTABLE: Record<string, string> = {
  sku: 'sku',
  name: 'name',
  stock_qty: 'stockQty',
  reorder_point: 'reorderPoint',
};

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItemEntity)
    private readonly items: Repository<InventoryItemEntity>,
    @InjectRepository(StockMovementEntity)
    private readonly movements: Repository<StockMovementEntity>,
    private readonly dataSource: DataSource,
    private readonly activity: ActivityService,
  ) {}

  /** Catalog is readable by everyone (Part 1 §1); only writes are restricted. */
  async list(
    filters: ItemListFilters,
  ): Promise<{ rows: InventoryItemEntity[]; count: number }> {
    const query = this.items.createQueryBuilder('item');

    if (filters.search) {
      query.andWhere('(item.sku ILIKE :search OR item.name ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }
    if (filters.lowStock) {
      query.andWhere('item.stock_qty <= item.reorder_point');
    }

    const orderBy = SORTABLE[filters.orderBy ?? ''] ?? 'name';
    query.orderBy(`item.${orderBy}`, filters.order === 'desc' ? 'DESC' : 'ASC');

    const [rows, count] = await query
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { rows, count };
  }

  findActive(): Promise<InventoryItemEntity[]> {
    return this.items.find({ where: { active: true }, order: { name: 'ASC' } });
  }

  /** Items at or below their reorder point — the dashboard's low-stock KPI. */
  lowStock(): Promise<InventoryItemEntity[]> {
    return this.items
      .createQueryBuilder('item')
      .where('item.stock_qty <= item.reorder_point')
      .andWhere('item.active = true')
      .orderBy('item.name', 'ASC')
      .getMany();
  }

  async findById(id: number): Promise<InventoryItemEntity> {
    const item = await this.items.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  movementsFor(itemId: number): Promise<StockMovementEntity[]> {
    return this.movements.find({
      where: { inventoryItem: { id: itemId } },
      relations: ['createdBy'],
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 100,
    });
  }

  async create(
    actor: User,
    dto: InventoryItemDto,
  ): Promise<InventoryItemEntity> {
    const existing = await this.items.findOne({
      where: { sku: ILike(dto.sku.trim()) },
    });

    if (existing) {
      throw new UnprocessableEntityException(
        `SKU ${dto.sku} already belongs to ${existing.name}.`,
      );
    }

    const item = await this.items.save(
      this.items.create({
        sku: dto.sku.trim(),
        name: dto.name.trim(),
        category: dto.category ?? null,
        unit: dto.unit || 'pcs',
        reorderPoint: String(dto.reorderPoint ?? 0),
        reorderQty: String(dto.reorderQty ?? 0),
        active: dto.active !== 'false',
      }),
    );

    await this.activity.log({
      entityType: 'inventory_item',
      entityId: item.id,
      action: 'created',
      actorId: Number(actor.id),
      detail: { sku: item.sku },
    });

    return item;
  }

  async update(actor: User, id: number, dto: InventoryItemDto): Promise<void> {
    // stock_qty is deliberately absent: stock only moves through adjustStock and the
    // triggers, so the ledger and the balance can never disagree.
    await this.items.update(id, {
      sku: dto.sku.trim(),
      name: dto.name.trim(),
      category: dto.category ?? null,
      unit: dto.unit || 'pcs',
      reorderPoint: String(dto.reorderPoint ?? 0),
      reorderQty: String(dto.reorderQty ?? 0),
      active: dto.active !== 'false',
    });

    await this.activity.log({
      entityType: 'inventory_item',
      entityId: id,
      action: 'updated',
      actorId: Number(actor.id),
    });
  }

  /**
   * Manual adjustment — manager/admin only. The item update and the ledger row happen in
   * one transaction with the row locked, so a concurrent claim or fulfilment cannot
   * interleave and leave `balance_after` lying. Refuses to take stock negative.
   */
  async adjustStock(
    actor: User,
    itemId: number,
    delta: string,
    note?: string,
  ): Promise<string> {
    const amount = new Decimal(delta);

    if (amount.isZero()) {
      throw new UnprocessableEntityException(
        'An adjustment of zero changes nothing.',
      );
    }

    const balanceAfter = await this.dataSource.transaction(async (manager) => {
      const item = await manager
        .createQueryBuilder(InventoryItemEntity, 'item')
        .setLock('pessimistic_write')
        .where('item.id = :id', { id: itemId })
        .getOne();

      if (!item) throw new NotFoundException('Inventory item not found');

      const balance = new Decimal(item.stockQty).plus(amount);

      if (balance.isNegative()) {
        throw new UnprocessableEntityException(
          `That would take ${item.sku} to ${balance.toFixed(4)}. Stock cannot go below zero.`,
        );
      }

      await manager.update(InventoryItemEntity, itemId, {
        stockQty: balance.toFixed(4),
      });

      await manager.save(
        manager.create(StockMovementEntity, {
          inventoryItem: { id: itemId } as never,
          delta: amount.toFixed(4),
          reason: MovementReasonEnum.adjustment,
          refTable: 'inventory_items',
          refId: itemId,
          balanceAfter: balance.toFixed(4),
          createdBy: { id: Number(actor.id) } as never,
        }),
      );

      return balance.toFixed(4);
    });

    await this.activity.log({
      entityType: 'inventory_item',
      entityId: itemId,
      action: 'stock_adjusted',
      actorId: Number(actor.id),
      detail: { delta, balanceAfter, note: note ?? null },
    });

    return balanceAfter;
  }
}
