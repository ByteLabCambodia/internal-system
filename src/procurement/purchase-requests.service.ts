import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PurchaseRequestEntity } from './entities/purchase-request.entity';
import { PurchaseRequestItemEntity } from './entities/purchase-request-item.entity';
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

/**
 * Sort keys as they appear in the URL, mapped to entity properties. TypeORM's orderBy needs
 * the property name (not the column) once skip/take are involved, and the allowlist keeps a
 * query parameter from reaching SQL.
 */
const SORTABLE: Record<string, string> = {
  pr_number: 'prNumber',
  status: 'status',
  total_usd: 'totalUsd',
  created_at: 'createdAt',
};

@Injectable()
export class PurchaseRequestsService {
  constructor(
    @InjectRepository(PurchaseRequestEntity)
    private readonly repository: Repository<PurchaseRequestEntity>,
    private readonly dataSource: DataSource,
    private readonly money: MoneyService,
    private readonly rates: RatesService,
    private readonly activity: ActivityService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Row scoping (Part 1 §1): own rows, or every row for manager/finance/admin. Applied in
   * the query, never in the template.
   */
  private applyScope(
    query: ReturnType<Repository<PurchaseRequestEntity>['createQueryBuilder']>,
    actor: User,
  ) {
    if (!this.permissions.seesAllRows(actor)) {
      query.andWhere('pr.requester_id = :actorId', { actorId: actor.id });
    }
    return query;
  }

  async list(
    actor: User,
    filters: PrListFilters,
  ): Promise<{ rows: PurchaseRequestEntity[]; count: number }> {
    const query = this.repository
      .createQueryBuilder('pr')
      .leftJoinAndSelect('pr.requester', 'requester')
      .leftJoinAndSelect('pr.department', 'department');

    this.applyScope(query, actor);

    if (filters.status) {
      query.andWhere('pr.status = :status', { status: filters.status });
    }
    if (filters.search) {
      query.andWhere('(pr.pr_number ILIKE :search OR pr.note ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }
    if (filters.from) {
      query.andWhere('pr.created_at >= :from', { from: filters.from });
    }
    if (filters.to) {
      query.andWhere('pr.created_at < (:to::date + 1)', { to: filters.to });
    }

    const orderBy = SORTABLE[filters.orderBy ?? ''] ?? 'createdAt';
    query.orderBy(`pr.${orderBy}`, filters.order === 'asc' ? 'ASC' : 'DESC');

    const [rows, count] = await query
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { rows, count };
  }

  async findOneForActor(
    actor: User,
    id: number,
  ): Promise<PurchaseRequestEntity> {
    const query = this.repository
      .createQueryBuilder('pr')
      .leftJoinAndSelect('pr.requester', 'requester')
      .leftJoinAndSelect('pr.approver', 'approver')
      .leftJoinAndSelect('pr.department', 'department')
      .leftJoinAndSelect('pr.project', 'project')
      .leftJoinAndSelect('pr.items', 'items')
      .where('pr.id = :id', { id });

    this.applyScope(query, actor);

    const row = await query.getOne();
    if (!row) throw new NotFoundException('Purchase request not found');

    return row;
  }

  /**
   * The FX rate is never user input: the server looks up the day's rate and locks it onto
   * the record. A foreign currency with no rate on file is refused rather than defaulted
   * to 1, which would silently misstate every downstream USD figure.
   */
  private async lockRate(currency: CurrencyEnum): Promise<string> {
    const rate = await this.rates.getCurrentRate(currency);

    if (!rate) {
      throw new UnprocessableEntityException(
        `No exchange rate on file for ${currency}. Finance must set today's rate first.`,
      );
    }

    return rate;
  }

  async create(
    actor: User,
    dto: CreatePurchaseRequestDto,
    submit: boolean,
  ): Promise<PurchaseRequestEntity> {
    const exchangeRate = await this.lockRate(dto.currency);
    const totalOriginal = this.money.sum(
      dto.items.map((item) => this.money.lineTotal(item.qty, item.unitPrice)),
    );

    const id = await this.dataSource.transaction(async (manager) => {
      const pr = await manager.save(
        manager.create(PurchaseRequestEntity, {
          requester: { id: Number(actor.id) } as never,
          status: submit ? PrStatusEnum.pending : PrStatusEnum.draft,
          currency: dto.currency,
          exchangeRate,
          totalOriginal,
          department: dto.departmentId
            ? ({ id: dto.departmentId } as never)
            : null,
          project: dto.projectId ? ({ id: dto.projectId } as never) : null,
          note: dto.note ?? null,
        }),
      );

      await manager.save(
        dto.items.map((item) =>
          manager.create(PurchaseRequestItemEntity, {
            purchaseRequest: { id: pr.id } as never,
            name: item.name,
            qty: String(item.qty),
            unitPriceOriginal: String(item.unitPrice),
            inventoryItem: item.inventoryItemId
              ? ({ id: item.inventoryItemId } as never)
              : null,
            category: item.category ?? null,
          }),
        ),
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

    // Re-read: total_usd is derived by trigger T1, not by us.
    return this.findOneForActor(actor, id);
  }

  async submit(actor: User, id: number): Promise<PurchaseRequestEntity> {
    const pr = await this.findOneForActor(actor, id);

    if (pr.status !== PrStatusEnum.draft) {
      throw new UnprocessableEntityException(
        'Only a draft request can be submitted.',
      );
    }

    // Re-lock the rate at submit time, which is when the brief says it fixes.
    const exchangeRate = await this.lockRate(pr.currency);

    await this.repository.update(id, {
      status: PrStatusEnum.pending,
      exchangeRate,
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
   * attempt a decision; here we enforce the C2 amount tier.
   *
   * Deviation from the brief's C2: self-approval is deliberately allowed for manager/admin,
   * on the user's explicit instruction. Since `pr.decide` is already restricted to those two
   * roles, this removes the self-approval block entirely rather than carving out an
   * exception — there is no third role it could apply to. Kept "explicit and logged" per the
   * brief's own suggested escape-hatch condition: every decision is activity-logged with the
   * deciding actor, and a self-approval is flagged in that log (`selfApproved: true`) so it
   * reads as a deliberate, visible event rather than an accidental gap. See AGENTS.md.
   */
  async decide(
    actor: User,
    id: number,
    decision: 'approved' | 'rejected',
  ): Promise<PurchaseRequestEntity> {
    const pr = await this.findOneForActor(actor, id);

    if (pr.status !== PrStatusEnum.pending) {
      throw new UnprocessableEntityException(
        'Only a pending request can be decided.',
      );
    }

    const selfApproved = Number(pr.requester.id) === Number(actor.id);

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

    await this.repository.update(id, {
      status:
        decision === 'approved' ? PrStatusEnum.approved : PrStatusEnum.rejected,
      approver: { id: Number(actor.id) } as never,
      decidedAt: new Date(),
    });

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: decision,
      actorId: Number(actor.id),
      detail: {
        totalUsd: pr.totalUsd,
        ...(selfApproved ? { selfApproved: true } : {}),
      },
    });

    return this.findOneForActor(actor, id);
  }

  async cancel(actor: User, id: number): Promise<void> {
    const pr = await this.findOneForActor(actor, id);

    const cancellable: PrStatusEnum[] = [
      PrStatusEnum.draft,
      PrStatusEnum.pending,
      PrStatusEnum.approved,
    ];

    if (!cancellable.includes(pr.status)) {
      throw new UnprocessableEntityException(
        `A ${pr.status} request cannot be cancelled.`,
      );
    }

    await this.repository.update(id, { status: PrStatusEnum.cancelled });

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
   * PurchaseRequestItemEntity), so nothing else needs cleaning up here.
   */
  async remove(actor: User, id: number): Promise<void> {
    const pr = await this.findOneForActor(actor, id);

    const deletable: PrStatusEnum[] = [
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

    await this.repository.delete(id);

    await this.activity.log({
      entityType: 'purchase_request',
      entityId: id,
      action: 'deleted',
      actorId: Number(actor.id),
    });
  }

  /** Approved requests with no purchase order yet — the source list for the PO form. */
  findConvertible(): Promise<PurchaseRequestEntity[]> {
    return this.repository
      .createQueryBuilder('pr')
      .leftJoinAndSelect('pr.items', 'items')
      .leftJoinAndSelect('pr.requester', 'requester')
      .where('pr.status = :status', { status: PrStatusEnum.approved })
      .orderBy('pr.created_at', 'DESC')
      .getMany();
  }
}
