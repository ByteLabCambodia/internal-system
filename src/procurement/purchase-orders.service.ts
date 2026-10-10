import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { and, or, orderByField } from '@prisma/orm-postgres/orm-client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { money, rate } from '../prisma/numeric';
import { contains } from '../prisma/like';
import { nextDay } from '../prisma/dates-filter';
import { PaymentStatusEnum, PoStatusEnum, PrStatusEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { ActivityService } from '../activity/activity.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  AccountsService,
  MISC_EXPENSE_ACCOUNT_CODE,
} from '../accounting/accounts.service';
import { SuppliersService } from '../org/suppliers.service';
import { User } from '../users/domain/user';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

export type PoListFilters = {
  status?: PoStatusEnum;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
};

/** URL sort key → model field; the allowlist keeps a query parameter from reaching SQL. */
const SORTABLE = {
  po_number: 'poNumber',
  status: 'status',
  payment_status: 'paymentStatus',
  total_usd: 'totalUsd',
  created_at: 'createdAt',
} as const;
const SORT_FIELDS = Object.values(SORTABLE) as [
  (typeof SORTABLE)[keyof typeof SORTABLE],
  ...(typeof SORTABLE)[keyof typeof SORTABLE][],
];

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionsService,
    private readonly accounts: AccountsService,
    private readonly suppliers: SuppliersService,
  ) {}

  private get orders() {
    return this.prisma.db.orm.public.PurchaseOrder;
  }

  /** Own created rows, or every row for manager/finance/admin. */
  private scoped(actor: User) {
    return this.permissions.seesAllRows(actor)
      ? this.orders.where({})
      : this.orders.where({ createdById: Number(actor.id) });
  }

  async list(actor: User, filters: PoListFilters) {
    const { search, from, to } = filters;
    const orders = this.scoped(actor).where((po) =>
      and(
        ...(filters.status ? [po.status.eq(filters.status)] : []),
        ...(search
          ? [
              or(
                po.poNumber.ilike(contains(search)),
                po.supplierRecord.some((s) => s.name.ilike(contains(search))),
                po.supplierName.ilike(contains(search)),
              ),
            ]
          : []),
        ...(from ? [po.createdAt.gte(from)] : []),
        ...(to ? [po.createdAt.lt(nextDay(to))] : []),
      ),
    );

    const field =
      SORTABLE[filters.orderBy as keyof typeof SORTABLE] ?? 'createdAt';

    const [rows, total] = await Promise.all([
      orders
        .include('supplierRecord')
        .include('createdBy')
        .orderBy([
          orderByField(
            this.orders,
            field,
            filters.order === 'asc' ? 'asc' : 'desc',
            SORT_FIELDS,
          ),
          (po) => po.id.desc(),
        ])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      orders.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findOneForActor(actor: User, id: number) {
    const row = await this.scoped(actor)
      .where({ id })
      .include('supplierRecord')
      .include('expenseAccount')
      .include('department')
      .include('project')
      .include('createdBy')
      .include('purchaseRequest', (pr) => pr.include('requester'))
      .include('items', (items) => items.orderBy((i) => i.id.asc()))
      .first();

    if (!row) throw new NotFoundException('Purchase order not found');

    return row;
  }

  /**
   * C1: if every line shares one category, debit that category's account; otherwise fall
   * back to 6900 Misc Expense. Finance can override on the form, which wins.
   */
  async resolveExpenseAccountId(
    categories: (string | null | undefined)[],
    override?: number,
  ): Promise<number | null> {
    if (override) return override;

    const distinct = [...new Set(categories.filter(Boolean))] as string[];

    if (distinct.length === 1) {
      const category = await this.prisma.db.orm.public.Category.where({
        name: distinct[0],
      }).first();

      if (category?.expenseAccountId) return category.expenseAccountId;
    }

    const misc = await this.accounts.findByCode(MISC_EXPENSE_ACCOUNT_CODE);
    return misc?.id ?? null;
  }

  async createFromRequest(actor: User, dto: CreatePurchaseOrderDto) {
    // The order inherits the request's department and project, and they become the
    // dimensions on the journal lines when a payment posts (expense by department).
    const pr = await this.prisma.db.orm.public.PurchaseRequest.where({
      id: dto.prId,
    })
      .include('items')
      .first();

    if (!pr) throw new NotFoundException('Purchase request not found');

    if (pr.status !== PrStatusEnum.approved) {
      throw new UnprocessableEntityException(
        `Purchase request ${pr.prNumber} is ${pr.status}; only an approved request can become an order.`,
      );
    }

    // A supplier chosen from the list, or created on the fly from a typed name (C4).
    let supplierId = dto.supplierId ?? null;
    let supplierName: string | null = null;
    if (!supplierId && dto.supplierName?.trim()) {
      const supplier = await this.suppliers.findOrCreateByName(
        dto.supplierName,
      );
      supplierId = supplier.id;
      supplierName = supplier.name;
    }

    const expenseAccountId = await this.resolveExpenseAccountId(
      pr.items.map((item) => item.category),
      dto.expenseAccountId,
    );

    const totalOriginal = this.money.sum(
      dto.items.map((item) =>
        this.money.lineTotal(item.qtyOrdered, item.unitPrice),
      ),
    );

    const id = await this.prisma.db.transaction(async (tx) => {
      const po = await tx.orm.public.PurchaseOrder.create({
        prId: pr.id,
        type: dto.type,
        supplierId,
        supplierName,
        expenseAccountId,
        // The order inherits the rate the request locked, not today's.
        currency: pr.currency,
        exchangeRate: rate(pr.exchangeRate),
        totalOriginal: money(totalOriginal),
        totalUsd: money(this.money.toUsd(totalOriginal, pr.exchangeRate)),
        departmentId: pr.departmentId,
        projectId: pr.projectId,
        createdById: Number(actor.id),
      });

      await tx.orm.public.PurchaseOrderItem.createAll(
        dto.items.map((item) => ({
          poId: po.id,
          name: item.name,
          qtyOrdered: money(String(item.qtyOrdered)),
          unitPriceOriginal: money(String(item.unitPrice)),
          inventoryItemId: item.inventoryItemId || null,
        })),
      );

      // The request flips to converted as part of the same transaction.
      await tx.orm.public.PurchaseRequest.where({ id: pr.id }).update({
        status: PrStatusEnum.converted,
      });

      return po.id;
    });

    await this.activity.log({
      entityType: 'purchase_order',
      entityId: id,
      action: 'created',
      actorId: Number(actor.id),
      detail: { prNumber: pr.prNumber, totalOriginal },
    });
    await this.activity.log({
      entityType: 'purchase_request',
      entityId: pr.id,
      action: 'converted',
      actorId: Number(actor.id),
      detail: { purchaseOrderId: id },
    });

    return this.findOneForActor(actor, id);
  }

  async cancel(actor: User, id: number): Promise<void> {
    const po = await this.findOneForActor(actor, id);

    if (po.status === PoStatusEnum.cancelled) {
      throw new UnprocessableEntityException(
        'This order is already cancelled.',
      );
    }
    if (po.status === PoStatusEnum.complete) {
      throw new UnprocessableEntityException(
        'A completed order cannot be cancelled.',
      );
    }

    await this.orders.where({ id }).update({ status: PoStatusEnum.cancelled });

    await this.activity.log({
      entityType: 'purchase_order',
      entityId: id,
      action: 'cancelled',
      actorId: Number(actor.id),
    });
  }

  /**
   * Locks an order for the rest of the caller's transaction. Payments against the same
   * order queue up here, so the over-payment check always sees every committed payment.
   */
  async lockForPayment(tx: Tx, id: number) {
    return await tx.orm.public.PurchaseOrder.where({ id }).forUpdate().first();
  }

  /** unpaid / partial / paid from the USD sum of every payment against the order. */
  async rollUpPaymentStatus(
    tx: Tx,
    po: { id: number; totalUsd: string },
  ): Promise<void> {
    const paid = await this.paidUsd(tx, po.id);

    const paymentStatus =
      this.money.compare(paid, po.totalUsd) >= 0
        ? PaymentStatusEnum.paid
        : this.money.isPositive(paid)
          ? PaymentStatusEnum.partial
          : PaymentStatusEnum.unpaid;

    await tx.orm.public.PurchaseOrder.where({ id: po.id }).update({
      paymentStatus,
    });
  }

  async paidUsd(tx: Tx, poId: number): Promise<string> {
    const { total } = await tx.orm.public.Payment.where({ poId }).aggregate(
      (a) => ({ total: a.sum('amountUsd') }),
    );

    return total ?? '0';
  }

  /**
   * Goods received against an order line (C3): refuses to go past the ordered quantity
   * plus `tolerance`, advances the line, then moves the order to partial or complete. A
   * cancelled order keeps its status. Locks line before order, the same order every
   * other receipt takes.
   */
  async receive(
    tx: Tx,
    poItemId: number,
    qty: string,
    tolerance: Decimal,
  ): Promise<void> {
    const lines = tx.orm.public.PurchaseOrderItem;
    const line = await lines.where({ id: poItemId }).forUpdate().first();

    if (!line) throw new NotFoundException('Purchase order line not found');

    const claimed = new Decimal(line.qtyClaimed);
    const ordered = new Decimal(line.qtyOrdered);
    const received = new Decimal(qty);

    if (claimed.plus(received).greaterThan(ordered.times(tolerance.plus(1)))) {
      throw new UnprocessableEntityException(
        `over-receipt on purchase order line ${line.id}: ${claimed.toFixed(4)} already claimed + ${received.toFixed(4)} exceeds ${ordered.toFixed(4)} ordered`,
      );
    }

    await lines.where({ id: line.id }).update({
      qtyClaimed: money(claimed.plus(received).toFixed(4)),
    });

    const po = await tx.orm.public.PurchaseOrder.where({ id: line.poId })
      .forUpdate()
      .first();

    if (!po || po.status === PoStatusEnum.cancelled) return;

    const { outstanding } = await lines
      .where({ poId: po.id })
      .where((l) => l.qtyClaimed.lt(l.qtyOrdered))
      .aggregate((a) => ({ outstanding: a.count() }));

    await tx.orm.public.PurchaseOrder.where({ id: po.id }).update({
      status: outstanding === 0 ? PoStatusEnum.complete : PoStatusEnum.partial,
    });
  }

  /** Open or partly received orders — the ones a payment can be recorded against. */
  async findPayable() {
    return await this.orders
      .where((po) => po.status.neq(PoStatusEnum.cancelled))
      .where((po) => po.paymentStatus.neq(PaymentStatusEnum.paid))
      .include('supplierRecord')
      .orderBy([(po) => po.createdAt.desc(), (po) => po.id.desc()])
      .all();
  }
}
