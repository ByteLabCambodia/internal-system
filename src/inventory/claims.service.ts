import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { money, timestamptz } from '../prisma/numeric';
import { InventoryService } from './inventory.service';
import { PurchaseOrdersService } from '../procurement/purchase-orders.service';
import { SettingsService } from '../settings/settings.service';
import {
  ClaimStatusEnum,
  MovementReasonEnum,
  PoStatusEnum,
} from '../common/enums';
import { ActivityService } from '../activity/activity.service';
import { PermissionsService } from '../permissions/permissions.service';
import { User } from '../users/domain/user';
import { CreateClaimDto } from './dto/create-claim.dto';

export type ClaimListFilters = {
  status?: ClaimStatusEnum;
  page: number;
  limit: number;
};

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionsService,
  ) {}

  private get claims() {
    return this.prisma.db.orm.public.InventoryClaim;
  }

  /** Own claims, or every claim for manager/finance/admin. */
  private scoped(actor: User) {
    return this.permissions.seesAllRows(actor)
      ? this.claims.where({})
      : this.claims.where({ claimedById: Number(actor.id) });
  }

  async list(actor: User, filters: ClaimListFilters) {
    const claims = filters.status
      ? this.scoped(actor).where({ status: filters.status })
      : this.scoped(actor);

    const [rows, total] = await Promise.all([
      claims
        .include('inventoryItem')
        .include('purchaseOrder')
        .include('claimedBy')
        .include('confirmedBy')
        .orderBy([(c) => c.createdAt.desc(), (c) => c.id.desc()])
        .offset((filters.page - 1) * filters.limit)
        .limit(filters.limit)
        .all(),
      claims.aggregate((a) => ({ count: a.count() })),
    ]);

    return { rows, count: total.count };
  }

  async findOneForActor(actor: User, id: number) {
    const claim = await this.scoped(actor)
      .where({ id })
      .include('inventoryItem')
      .include('purchaseOrder')
      .include('purchaseOrderItem')
      .include('claimedBy')
      .first();

    if (!claim) throw new NotFoundException('Claim not found');

    return claim;
  }

  /**
   * The over-receipt rule is enforced again, under lock, on confirmation. Checking it here
   * too, at submission, gives the claimant a clean form error up front (C3 asks for this).
   */
  async create(actor: User, dto: CreateClaimDto) {
    const poItem = await this.prisma.db.orm.public.PurchaseOrderItem.where({
      id: dto.poItemId,
    }).first();

    if (!poItem) {
      throw new UnprocessableEntityException(
        'Choose the purchase order line these goods arrived against.',
      );
    }

    const tolerance = await this.settings.numeric('receipt_tolerance_pct');
    const claimed = new Decimal(poItem.qtyClaimed);
    const ordered = new Decimal(poItem.qtyOrdered);
    const wanted = new Decimal(dto.qtyClaimed);
    const ceiling = ordered.times(tolerance.plus(1));

    if (claimed.plus(wanted).greaterThan(ceiling)) {
      const remaining = ceiling.minus(claimed);
      throw new UnprocessableEntityException(
        remaining.lessThanOrEqualTo(0)
          ? `${poItem.name} is already fully received against this order.`
          : `Only ${remaining.toFixed(4)} of ${poItem.name} is still outstanding on this order.`,
      );
    }

    // `||`, not `??`: the form's hidden "Receive into" select still posts an empty value
    // for a linked line, which arrives here as 0.
    const inventoryItemId = dto.inventoryItemId || poItem.inventoryItemId;

    if (!inventoryItemId) {
      throw new UnprocessableEntityException(
        'This order line is not linked to a catalog item — choose which item to receive into stock.',
      );
    }

    const claim = await this.claims.create({
      poId: poItem.poId,
      poItemId: poItem.id,
      inventoryItemId,
      qtyClaimed: money(String(dto.qtyClaimed)),
      receiptObjectKey: dto.receiptObjectKey ?? null,
      claimedById: Number(actor.id),
    });

    await this.activity.log({
      entityType: 'inventory_claim',
      entityId: claim.id,
      action: 'created',
      actorId: Number(actor.id),
      detail: { qtyClaimed: dto.qtyClaimed, poItemId: poItem.id },
    });

    return claim;
  }

  /**
   * Confirming receives the goods: re-checks the over-receipt guard against the locked PO
   * line, advances the line and the order, moves the stock in and appends the ledger row,
   * all in one transaction. The claim row is locked first so it can only be confirmed once.
   */
  async confirm(actor: User, id: number): Promise<void> {
    const tolerance = await this.settings.numeric('receipt_tolerance_pct');

    await this.prisma.db.transaction(async (tx) => {
      const claims = tx.orm.public.InventoryClaim;
      const claim = await claims.where({ id }).forUpdate().first();

      if (!claim) throw new NotFoundException('Claim not found');

      if (claim.status !== ClaimStatusEnum.pending) {
        throw new UnprocessableEntityException(
          `This claim is already ${claim.status}.`,
        );
      }

      if (claim.poItemId) {
        await this.purchaseOrders.receive(
          tx,
          claim.poItemId,
          claim.qtyClaimed,
          tolerance,
        );
      }

      await this.inventory.applyMovement(tx, {
        itemId: claim.inventoryItemId,
        delta: new Decimal(claim.qtyClaimed),
        reason: MovementReasonEnum.claim,
        refTable: 'inventory_claims',
        refId: claim.id,
        actorId: Number(actor.id),
        onNegative: () => 'A claim cannot take stock below zero.',
      });

      await claims.where({ id }).update({
        status: ClaimStatusEnum.confirmed,
        confirmedById: Number(actor.id),
        confirmedAt: claim.confirmedAt ?? timestamptz(new Date()),
      });
    });

    await this.activity.log({
      entityType: 'inventory_claim',
      entityId: id,
      action: 'confirmed',
      actorId: Number(actor.id),
    });
  }

  async reject(actor: User, id: number): Promise<void> {
    const claim = await this.claims.where({ id }).first();
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatusEnum.pending) {
      throw new UnprocessableEntityException(
        `This claim is already ${claim.status}.`,
      );
    }

    await this.claims.where({ id }).update({
      status: ClaimStatusEnum.rejected,
      confirmedById: Number(actor.id),
    });

    await this.activity.log({
      entityType: 'inventory_claim',
      entityId: id,
      action: 'rejected',
      actorId: Number(actor.id),
    });
  }

  /** Order lines with something still outstanding — the options on the claim form. */
  async claimableLines() {
    return await this.prisma.db.orm.public.PurchaseOrderItem.where((line) =>
      line.purchaseOrder.some((po) => po.status.neq(PoStatusEnum.cancelled)),
    )
      .where((line) => line.qtyClaimed.lt(line.qtyOrdered))
      .include('purchaseOrder')
      .include('inventoryItem')
      .orderBy([
        (line) => line.purchaseOrder.createdAt.desc(),
        (line) => line.id.asc(),
      ])
      .all();
  }
}
