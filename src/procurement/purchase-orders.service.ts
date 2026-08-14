import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PurchaseRequestEntity } from './entities/purchase-request.entity';
import { CategoryEntity } from '../inventory/entities/category.entity';
import { PoStatusEnum, PrStatusEnum } from '../common/enums';
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

/** URL sort key → entity property; see the note in purchase-requests.service.ts. */
const SORTABLE: Record<string, string> = {
  po_number: 'poNumber',
  status: 'status',
  payment_status: 'paymentStatus',
  total_usd: 'totalUsd',
  created_at: 'createdAt',
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectRepository(PurchaseOrderEntity)
    private readonly repository: Repository<PurchaseOrderEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    private readonly dataSource: DataSource,
    private readonly money: MoneyService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionsService,
    private readonly accounts: AccountsService,
    private readonly suppliers: SuppliersService,
  ) {}

  /** Own created rows, or every row for manager/finance/admin. */
  private applyScope(
    query: ReturnType<Repository<PurchaseOrderEntity>['createQueryBuilder']>,
    actor: User,
  ) {
    if (!this.permissions.seesAllRows(actor)) {
      query.andWhere('po.created_by = :actorId', { actorId: actor.id });
    }
    return query;
  }

  async list(
    actor: User,
    filters: PoListFilters,
  ): Promise<{ rows: PurchaseOrderEntity[]; count: number }> {
    const query = this.repository
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .leftJoinAndSelect('po.createdBy', 'createdBy');

    this.applyScope(query, actor);

    if (filters.status) {
      query.andWhere('po.status = :status', { status: filters.status });
    }
    if (filters.search) {
      query.andWhere(
        '(po.po_number ILIKE :search OR supplier.name ILIKE :search OR po.supplier ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }
    if (filters.from) {
      query.andWhere('po.created_at >= :from', { from: filters.from });
    }
    if (filters.to) {
      query.andWhere('po.created_at < (:to::date + 1)', { to: filters.to });
    }

    const orderBy = SORTABLE[filters.orderBy ?? ''] ?? 'createdAt';
    query.orderBy(`po.${orderBy}`, filters.order === 'asc' ? 'ASC' : 'DESC');

    const [rows, count] = await query
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return { rows, count };
  }

  async findOneForActor(actor: User, id: number): Promise<PurchaseOrderEntity> {
    const query = this.repository
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .leftJoinAndSelect('po.expenseAccount', 'expenseAccount')
      .leftJoinAndSelect('po.department', 'department')
      .leftJoinAndSelect('po.project', 'project')
      .leftJoinAndSelect('po.createdBy', 'createdBy')
      .leftJoinAndSelect('po.purchaseRequest', 'purchaseRequest')
      .leftJoinAndSelect('purchaseRequest.requester', 'requester')
      .leftJoinAndSelect('po.items', 'items')
      .where('po.id = :id', { id });

    this.applyScope(query, actor);

    const row = await query.getOne();
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
      const category = await this.categories.findOne({
        where: { name: distinct[0] },
        relations: ['expenseAccount'],
      });

      if (category?.expenseAccount) return category.expenseAccount.id;
    }

    const misc = await this.accounts.findByCode(MISC_EXPENSE_ACCOUNT_CODE);
    return misc?.id ?? null;
  }

  async createFromRequest(
    actor: User,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderEntity> {
    // department and project are loaded because the order inherits them, and they become
    // the dimensions on the journal lines when a payment posts (expense by department).
    const pr = await this.dataSource
      .getRepository(PurchaseRequestEntity)
      .findOne({
        where: { id: dto.prId },
        relations: ['items', 'department', 'project'],
      });

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

    const id = await this.dataSource.transaction(async (manager) => {
      const po = await manager.save(
        manager.create(PurchaseOrderEntity, {
          purchaseRequest: { id: pr.id } as never,
          type: dto.type,
          supplier: supplierId ? ({ id: supplierId } as never) : null,
          supplierName,
          expenseAccount: expenseAccountId
            ? ({ id: expenseAccountId } as never)
            : null,
          // The order inherits the rate the request locked, not today's.
          currency: pr.currency,
          exchangeRate: pr.exchangeRate,
          totalOriginal,
          department: pr.department,
          project: pr.project,
          createdBy: { id: Number(actor.id) } as never,
        }),
      );

      await manager.save(
        dto.items.map((item) =>
          manager.create(PurchaseOrderItemEntity, {
            purchaseOrder: { id: po.id } as never,
            name: item.name,
            qtyOrdered: String(item.qtyOrdered),
            unitPriceOriginal: String(item.unitPrice),
            inventoryItem: item.inventoryItemId
              ? ({ id: item.inventoryItemId } as never)
              : null,
          }),
        ),
      );

      // The request flips to converted as part of the same transaction.
      await manager.update(PurchaseRequestEntity, pr.id, {
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

    await this.repository.update(id, { status: PoStatusEnum.cancelled });

    await this.activity.log({
      entityType: 'purchase_order',
      entityId: id,
      action: 'cancelled',
      actorId: Number(actor.id),
    });
  }

  /** Open or partly received orders — the ones a payment can be recorded against. */
  findPayable(): Promise<PurchaseOrderEntity[]> {
    return this.repository
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .where('po.status != :cancelled', { cancelled: PoStatusEnum.cancelled })
      .andWhere('po.payment_status != :paid', { paid: 'paid' })
      .orderBy('po.created_at', 'DESC')
      .getMany();
  }
}
