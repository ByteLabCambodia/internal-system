import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { InventoryClaimEntity } from './entities/inventory-claim.entity';
import { PurchaseOrderItemEntity } from '../procurement/entities/purchase-order-item.entity';
import { AppSettingEntity } from '../settings/entities/app-setting.entity';
import { ClaimStatusEnum } from '../common/enums';
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
    @InjectRepository(AppSettingEntity)
    private readonly settings: Repository<AppSettingEntity>,
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

  private async receiptTolerance(): Promise<Decimal> {
    const row = await this.settings.findOne({
      where: { key: 'receipt_tolerance_pct' },
    });

    try {
      return new Decimal(row?.value ?? 0);
    } catch {
      return new Decimal(0);
    }
  }

  /**
   * The over-receipt rule is enforced by trigger T3 on confirmation. We check it here too,
   * at submission, so the claimant gets a clean form error instead of a manager hitting a
   * 500 later (C3 asks for exactly this).
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

    const tolerance = await this.receiptTolerance();
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
   * Confirming is the database's job: trigger T3 re-checks the over-receipt guard, moves
   * the stock, appends the ledger row, advances the PO line and recomputes the order's
   * status. We flip the status and let it raise.
   */
  async confirm(actor: User, id: number): Promise<void> {
    const claim = await this.repository.findOne({ where: { id } });
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatusEnum.pending) {
      throw new UnprocessableEntityException(
        `This claim is already ${claim.status}.`,
      );
    }

    try {
      await this.repository.update(id, {
        status: ClaimStatusEnum.confirmed,
        confirmedBy: { id: Number(actor.id) } as never,
      });
    } catch (error) {
      if (error instanceof QueryFailedError) {
        throw new UnprocessableEntityException(
          (error as QueryFailedError & { driverError?: { message?: string } })
            .driverError?.message ?? error.message,
        );
      }
      throw error;
    }

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
