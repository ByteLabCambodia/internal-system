import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { and, or, orderByField } from '@prisma/orm-postgres/orm-client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { money } from '../prisma/numeric';
import { contains, escapeLike } from '../prisma/like';
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

/** URL sort key → model field; the allowlist keeps a query parameter from reaching SQL. */
const SORTABLE = {
  sku: 'sku',
  name: 'name',
  stock_qty: 'stockQty',
  reorder_point: 'reorderPoint',
} as const;
const SORT_FIELDS = Object.values(SORTABLE) as [
  (typeof SORTABLE)[keyof typeof SORTABLE],
  ...(typeof SORTABLE)[keyof typeof SORTABLE][],
];

/** The locked item row applyMovement hands back. */
export type InventoryItemRow = {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  stockQty: string;
  reorderPoint: string;
  reorderQty: string;
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  private get items() {
    return this.prisma.db.orm.public.InventoryItem;
  }

  /** Catalog is readable by everyone (Part 1 §1); only writes are restricted. */
  async list(filters: ItemListFilters) {
    const { search } = filters;
    const items = this.items.where((item) =>
      and(
        ...(search
          ? [
              or(
                item.sku.ilike(contains(search)),
                item.name.ilike(contains(search)),
              ),
            ]
          : []),
        ...(filters.lowStock ? [item.stockQty.lte(item.reorderPoint)] : []),
      ),
    );

    const field = SORTABLE[filters.orderBy as keyof typeof SORTABLE] ?? 'name';

    const [rows, total] = await Promise.all([
      items
        .orderBy([
          orderByField(
            this.items,
            field,
            filters.order === 'desc' ? 'desc' : 'asc',
            SORT_FIELDS,
          ),
          (item) => item.id.asc(),
        ])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      items.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findActive() {
    return await this.items
      .where({ active: true })
      .orderBy((item) => item.name.asc())
      .all();
  }

  /** Items at or below their reorder point — the dashboard's low-stock KPI. */
  async lowStock() {
    return await this.items
      .where({ active: true })
      .where((item) => item.stockQty.lte(item.reorderPoint))
      .orderBy((item) => item.name.asc())
      .all();
  }

  async findById(id: number) {
    const item = await this.items.where({ id }).first();
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  async movementsFor(itemId: number) {
    return await this.prisma.db.orm.public.StockMovement.where({
      inventoryItemId: itemId,
    })
      .include('createdBy')
      .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()])
      .limit(100)
      .all();
  }

  async create(actor: User, dto: InventoryItemDto) {
    const existing = await this.items
      .where((item) => item.sku.ilike(escapeLike(dto.sku.trim())))
      .first();

    if (existing) {
      throw new UnprocessableEntityException(
        `SKU ${dto.sku} already belongs to ${existing.name}.`,
      );
    }

    const item = await this.items.create(this.fields(dto));

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
    // stock_qty is deliberately absent: stock only moves through applyMovement, so the
    // ledger and the balance can never disagree.
    await this.items.where({ id }).update(this.fields(dto));

    await this.activity.log({
      entityType: 'inventory_item',
      entityId: id,
      action: 'updated',
      actorId: Number(actor.id),
    });
  }

  private fields(dto: InventoryItemDto) {
    return {
      sku: dto.sku.trim(),
      name: dto.name.trim(),
      category: dto.category ?? null,
      unit: dto.unit || 'pcs',
      reorderPoint: money(String(dto.reorderPoint ?? 0)),
      reorderQty: money(String(dto.reorderQty ?? 0)),
      active: dto.active !== 'false',
    };
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

    const balanceAfter = await this.prisma.db.transaction(async (tx) => {
      const { balanceAfter } = await this.applyMovement(tx, {
        itemId,
        delta: amount,
        reason: MovementReasonEnum.adjustment,
        refTable: 'inventory_items',
        refId: itemId,
        actorId: Number(actor.id),
        onNegative: (item, balance) =>
          `That would take ${item.sku} to ${balance.toFixed(4)}. Stock cannot go below zero.`,
      });
      return balanceAfter;
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

  /**
   * The only way stock changes: locks the item row, refuses to go below zero, updates the
   * balance and appends the movement ledger row, all inside the caller's transaction. The
   * lock means a concurrent claim, fulfilment or adjustment queues behind this one, so
   * `balance_after` is always the true running balance.
   */
  async applyMovement(
    tx: Tx,
    movement: {
      itemId: number;
      delta: Decimal;
      reason: MovementReasonEnum;
      refTable: string;
      refId: number;
      actorId: number | null;
      onNegative: (item: InventoryItemRow, balance: Decimal) => string;
    },
  ): Promise<{ item: InventoryItemRow; balanceAfter: string }> {
    const items = tx.orm.public.InventoryItem;
    const item = await items.where({ id: movement.itemId }).forUpdate().first();

    if (!item) throw new NotFoundException('Inventory item not found');

    const balance = new Decimal(item.stockQty).plus(movement.delta);

    if (balance.isNegative()) {
      throw new UnprocessableEntityException(
        movement.onNegative(item, balance),
      );
    }

    const balanceAfter = balance.toFixed(4);

    await items.where({ id: item.id }).update({
      stockQty: money(balanceAfter),
    });

    await tx.orm.public.StockMovement.create({
      inventoryItemId: item.id,
      delta: money(movement.delta.toFixed(4)),
      reason: movement.reason,
      refTable: movement.refTable,
      refId: movement.refId,
      balanceAfter: money(balanceAfter),
      createdById: movement.actorId,
    });

    return { item: { ...item, stockQty: balanceAfter }, balanceAfter };
  }
}
