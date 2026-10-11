import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, or, orderByField } from '@prisma/orm-postgres/orm-client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { money, rate, timestamptz } from '../prisma/numeric';
import { contains } from '../prisma/like';
import { nextDay } from '../prisma/dates-filter';
import { CurrencyEnum, PrStatusEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { RatesService } from '../accounting/rates.service';
import { ActivityService } from '../activity/activity.service';
import { ApprovalThresholdsService } from '../org/approval-thresholds.service';
import { PermissionsService } from '../permissions/permissions.service';
import { User } from '../users/domain/user';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';

export type PrListFilters = {
  status?: PrStatusEnum;
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
  pr_number: 'prNumber',
  status: 'status',
  total_usd: 'totalUsd',
  created_at: 'createdAt',
} as const;
const SORT_FIELDS = Object.values(SORTABLE) as [
  (typeof SORTABLE)[keyof typeof SORTABLE],
  ...(typeof SORTABLE)[keyof typeof SORTABLE][],
];

/** What an auto-reorder draft needs from the item it restocks. */
type ReorderItem = {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  reorderQty: string;
};

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly rates: RatesService,
    private readonly activity: ActivityService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly permissions: PermissionsService,
  ) {}

  private get requests() {
    return this.prisma.db.orm.public.PurchaseRequest;
  }

  /**
   * Row scoping (Part 1 §1): own rows, or every row for manager/finance/admin. Applied in
   * the query, never in the template.
   */
  private scoped(actor: User) {
    return this.permissions.seesAllRows(actor)
      ? this.requests.where({})
      : this.requests.where({ requesterId: Number(actor.id) });
  }

  async list(actor: User, filters: PrListFilters) {
    const { search, from, to } = filters;
    const requests = this.scoped(actor).where((pr) =>
      and(
        ...(filters.status ? [pr.status.eq(filters.status)] : []),
        ...(search
          ? [
              or(
                pr.prNumber.ilike(contains(search)),
                pr.note.ilike(contains(search)),
              ),
            ]
          : []),
        ...(from ? [pr.createdAt.gte(from)] : []),
        ...(to ? [pr.createdAt.lt(nextDay(to))] : []),
      ),
    );

    const field =
      SORTABLE[filters.orderBy as keyof typeof SORTABLE] ?? 'createdAt';

    const [rows, total] = await Promise.all([
      requests
        .include('requester')
        .include('department')
        .orderBy([
          orderByField(
            this.requests,
            field,
            filters.order === 'asc' ? 'asc' : 'desc',
            SORT_FIELDS,
          ),
          (pr) => pr.id.desc(),
        ])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      requests.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findOneForActor(actor: User, id: number) {
    const row = await this.scoped(actor)
      .where({ id })
      .include('requester')
      .include('approver')
      .include('department')
      .include('project')
      .include('items', (items) => items.orderBy((i) => i.id.asc()))
      .first();

    if (!row) throw new NotFoundException('Purchase request not found');

    return row;
  }

  /**
   * The FX rate is never user input: the server looks up the day's rate and locks it onto
   * the record. A foreign currency with no rate on file is refused rather than defaulted
   * to 1, which would silently misstate every downstream USD figure.
   */
  private async lockRate(currency: `${CurrencyEnum}`): Promise<string> {
    const rate = await this.rates.getCurrentRate(currency);

    if (!rate) {
      throw new UnprocessableEntityException(
        `No exchange rate on file for ${currency}. Finance must set today's rate first.`,
      );
    }

    return rate;
  }

  async create(actor: User, dto: CreatePurchaseRequestDto, submit: boolean) {
    const exchangeRate = await this.lockRate(dto.currency);
    const totalOriginal = this.money.sum(
      dto.items.map((item) => this.money.lineTotal(item.qty, item.unitPrice)),
    );

    const id = await this.prisma.db.transaction(async (tx) => {
      const pr = await tx.orm.public.PurchaseRequest.create({
        requesterId: Number(actor.id),
        status: submit ? PrStatusEnum.pending : PrStatusEnum.draft,
        currency: dto.currency,
        exchangeRate: rate(exchangeRate),
        totalOriginal: money(totalOriginal),
        totalUsd: money(this.money.toUsd(totalOriginal, exchangeRate)),
        departmentId: dto.departmentId || null,
        projectId: dto.projectId || null,
        note: dto.note ?? null,
      });

      await tx.orm.public.PurchaseRequestItem.createAll(
        dto.items.map((item) => ({
          prId: pr.id,
          name: item.name,
          qty: money(String(item.qty)),
          unitPriceOriginal: money(String(item.unitPrice)),
          inventoryItemId: item.inventoryItemId || null,
          category: item.category ?? null,
        })),
      );

      return pr.id;
    });

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: submit ? 'submitted' : 'created',
      actorId: Number(actor.id),
      detail: { currency: dto.currency, exchangeRate, totalOriginal },
    });

    return this.findOneForActor(actor, id);
  }

  /**
   * Auto-reorder: a zero-priced USD draft for the item's reorder quantity, raised in the
   * caller's transaction when stock lands at or below the reorder point. A person prices
   * and submits it.
   */
  async createReorderDraft(
    tx: Tx,
    requesterId: number,
    item: ReorderItem,
  ): Promise<number> {
    const pr = await tx.orm.public.PurchaseRequest.create({
      requesterId,
      status: PrStatusEnum.draft,
      currency: CurrencyEnum.USD,
      exchangeRate: rate('1'),
      totalOriginal: money('0'),
      totalUsd: money('0'),
      autoGenerated: true,
      note: `Auto-reorder: ${item.sku} at/below reorder point`,
    });

    await tx.orm.public.PurchaseRequestItem.create({
      prId: pr.id,
      name: item.name,
      qty: money(item.reorderQty),
      unitPriceOriginal: money('0'),
      inventoryItemId: item.id,
      category: item.category,
    });

    return pr.id;
  }

  async submit(actor: User, id: number) {
    const pr = await this.findOneForActor(actor, id);

    if (pr.status !== PrStatusEnum.draft) {
      throw new UnprocessableEntityException(
        'Only a draft request can be submitted.',
      );
    }

    // Re-lock the rate at submit time, which is when the brief says it fixes.
    const exchangeRate = await this.lockRate(pr.currency);

    await this.requests.where({ id }).update({
      status: PrStatusEnum.pending,
      exchangeRate: rate(exchangeRate),
      totalUsd: money(this.money.toUsd(pr.totalOriginal, exchangeRate)),
    });

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: 'submitted',
      actorId: Number(actor.id),
      detail: { exchangeRate },
    });

    return this.findOneForActor(actor, id);
  }

  /**
   * Approve or reject. Two checks: the permission guard already established the actor may
   * attempt a decision; here we enforce the C2 amount tier. Self-approval is allowed for
   * both manager and admin, on the user's explicit instruction.
   */
  async decide(actor: User, id: number, decision: 'approved' | 'rejected') {
    const pr = await this.findOneForActor(actor, id);

    if (pr.status !== PrStatusEnum.pending) {
      throw new UnprocessableEntityException(
        'Only a pending request can be decided.',
      );
    }

    if (decision === 'approved') {
      const check = await this.thresholds.check(
        Number(actor.role?.id),
        pr.totalUsd,
      );

      if (!check.ok) {
        const article = /^[aeiou]/i.test(check.requiredRole ?? '') ? 'an' : 'a';

        throw new ForbiddenException(
          check.requiredRole
            ? `This request is ${this.money.formatUsd(pr.totalUsd)}, above your ${this.money.formatUsd(check.limit)} approval limit. It needs ${article} ${check.requiredRole}.`
            : `This request is ${this.money.formatUsd(pr.totalUsd)}, above every configured approval limit.`,
        );
      }
    }

    await this.requests.where({ id }).update({
      status:
        decision === 'approved' ? PrStatusEnum.approved : PrStatusEnum.rejected,
      approverId: Number(actor.id),
      decidedAt: timestamptz(new Date()),
    });

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: decision,
      actorId: Number(actor.id),
      detail: {
        totalUsd: pr.totalUsd,
      },
    });

    return this.findOneForActor(actor, id);
  }

  async cancel(actor: User, id: number): Promise<void> {
    const pr = await this.findOneForActor(actor, id);

    const cancellable: `${PrStatusEnum}`[] = [
      PrStatusEnum.draft,
      PrStatusEnum.pending,
      PrStatusEnum.approved,
    ];

    if (!cancellable.includes(pr.status)) {
      throw new UnprocessableEntityException(
        `A ${pr.status} request cannot be cancelled.`,
      );
    }

    await this.requests
      .where({ id })
      .update({ status: PrStatusEnum.cancelled });

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: 'cancelled',
      actorId: Number(actor.id),
    });
  }

  /**
   * Hard delete — only for requests a Purchase Order was never created from. `approved`
   * and `converted` requests are excluded because purchase-orders.service.ts links a PO
   * to its source PR by id; deleting one out from under that link would orphan the PO's
   * reference. Line items cascade at the DB level (see the FK on
   * PurchaseRequestItem), so nothing else needs cleaning up here.
   */
  async remove(actor: User, id: number): Promise<void> {
    const pr = await this.findOneForActor(actor, id);

    const deletable: `${PrStatusEnum}`[] = [
      PrStatusEnum.draft,
      PrStatusEnum.pending,
      PrStatusEnum.cancelled,
      PrStatusEnum.rejected,
    ];

    if (!deletable.includes(pr.status)) {
      throw new UnprocessableEntityException(
        `A ${pr.status} request cannot be deleted.`,
      );
    }

    await this.requests.where({ id }).delete();

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: 'deleted',
      actorId: Number(actor.id),
    });
  }

  /** Approved requests with no purchase order yet — the source list for the PO form. */
  async findConvertible() {
    return await this.requests
      .where({ status: PrStatusEnum.approved })
      .include('items', (items) => items.orderBy((i) => i.id.asc()))
      .include('requester')
      .orderBy([(pr) => pr.createdAt.desc(), (pr) => pr.id.desc()])
      .all();
  }
}
