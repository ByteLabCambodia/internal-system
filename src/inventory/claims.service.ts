import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { InventoryClaimEntity } from './entities/inventory-claim.entity';
import { InventoryService } from './inventory.service';
import { PurchaseOrderItemEntity } from '../procurement/entities/purchase-order-item.entity';
import { PurchaseOrdersService } from '../procurement/purchase-orders.service';
import { SettingsService } from '../settings/settings.service';
import { ClaimStatusEnum, MovementReasonEnum } from '../common/enums';
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
    @InjectRepository(InventoryClaimEntity)
    private readonly repository: Repository<InventoryClaimEntity>,
    @InjectRepository(PurchaseOrderItemEntity)
    private readonly poItems: Repository<PurchaseOrderItemEntity>,
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Own claims, or every claim for manager/finance/admin. */
  private applyScope(
    query: ReturnType<Repository<InventoryClaimEntity>['createQueryBuilder']>,
    actor: User,
  ) {
    if (!this.permissions.seesAllRows(actor)) {
      query.andWhere('claim.claimed_by = :actorId', { actorId: actor.id });
    }
    return query;
  }

  async list(
    actor: User,
    filters: ClaimListFilters,
  ): Promise<{ rows: InventoryClaimEntity[]; count: number }> {
    const query = this.repository
      .createQueryBuilder('claim')
      .leftJoinAndSelect('claim.inventoryItem', 'item')
      .leftJoinAndSelect('claim.purchaseOrder', 'po')
      .leftJoinAndSelect('claim.claimedBy', 'claimedBy')
      .leftJoinAndSelect('claim.confirmedBy', 'confirmedBy');

    this.applyScope(query, actor);

    if (filters.status) {
      query.andWhere('claim.status = :status', { status: filters.status });
    }

    const [rows, count] = await query
      .orderBy('claim.createdAt', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { rows, count };
  }

  async findOneForActor(
    actor: User,
    id: number,
  ): Promise<InventoryClaimEntity> {
    const query = this.repository
      .createQueryBuilder('claim')
      .leftJoinAndSelect('claim.inventoryItem', 'item')
      .leftJoinAndSelect('claim.purchaseOrder', 'po')
      .leftJoinAndSelect('claim.purchaseOrderItem', 'poItem')
      .leftJoinAndSelect('claim.claimedBy', 'claimedBy')
      .where('claim.id = :id', { id });

    this.applyScope(query, actor);

    const claim = await query.getOne();
    if (!claim) throw new NotFoundException('Claim not found');

    return claim;
  }

  /**
   * The over-receipt rule is enforced again, under lock, on confirmation. Checking it here
   * too, at submission, gives the claimant a clean form error up front (C3 asks for this).
   */
  async create(
    actor: User,
    dto: CreateClaimDto,
  ): Promise<InventoryClaimEntity> {
    const poItem = await this.poItems.findOne({
      where: { id: dto.poItemId },
      relations: ['purchaseOrder', 'inventoryItem'],
    });

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

    const inventoryItemId = dto.inventoryItemId ?? poItem.inventoryItem?.id;

    if (!inventoryItemId) {
      throw new UnprocessableEntityException(
        'This order line is not linked to a catalog item — choose which item to receive into stock.',
      );
    }

    const claim = await this.repository.save(
      this.repository.create({
        purchaseOrder: poItem.purchaseOrder,
        purchaseOrderItem: { id: poItem.id } as never,
        inventoryItem: { id: inventoryItemId } as never,
        qtyClaimed: String(dto.qtyClaimed),
        receiptObjectKey: dto.receiptObjectKey ?? null,
        claimedBy: { id: Number(actor.id) } as never,
      }),
    );

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

    await this.dataSource.transaction(async (manager) => {
      const claim = await manager
        .createQueryBuilder(InventoryClaimEntity, 'claim')
        .leftJoinAndSelect('claim.purchaseOrderItem', 'poItem')
        .innerJoinAndSelect('claim.inventoryItem', 'item')
        .setLock('pessimistic_write', undefined, ['claim'])
        .where('claim.id = :id', { id })
        .getOne();

      if (!claim) throw new NotFoundException('Claim not found');

      if (claim.status !== ClaimStatusEnum.pending) {
        throw new UnprocessableEntityException(
          `This claim is already ${claim.status}.`,
        );
      }

      if (claim.purchaseOrderItem) {
        await this.purchaseOrders.receive(
          manager,
          claim.purchaseOrderItem.id,
          claim.qtyClaimed,
          tolerance,
        );
      }

      await this.inventory.applyMovement(manager, {
        itemId: claim.inventoryItem.id,
        delta: new Decimal(claim.qtyClaimed),
        reason: MovementReasonEnum.claim,
        refTable: 'inventory_claims',
        refId: claim.id,
        actorId: Number(actor.id),
        onNegative: () => 'A claim cannot take stock below zero.',
      });

      await manager.update(InventoryClaimEntity, id, {
        status: ClaimStatusEnum.confirmed,
        confirmedBy: { id: Number(actor.id) } as never,
        confirmedAt: claim.confirmedAt ?? new Date(),
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
    const claim = await this.repository.findOne({ where: { id } });
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatusEnum.pending) {
      throw new UnprocessableEntityException(
        `This claim is already ${claim.status}.`,
      );
    }

    await this.repository.update(id, {
      status: ClaimStatusEnum.rejected,
      confirmedBy: { id: Number(actor.id) } as never,
    });

    await this.activity.log({
      entityType: 'inventory_claim',
      entityId: id,
      action: 'rejected',
      actorId: Number(actor.id),
    });
  }

  /** Order lines with something still outstanding — the options on the claim form. */
  async claimableLines(): Promise<PurchaseOrderItemEntity[]> {
    return this.poItems
      .createQueryBuilder('poItem')
      .leftJoinAndSelect('poItem.purchaseOrder', 'po')
      .leftJoinAndSelect('poItem.inventoryItem', 'item')
      .where('po.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('poItem.qty_claimed < poItem.qty_ordered')
      .orderBy('po.createdAt', 'DESC')
      .getMany();
  }
}
