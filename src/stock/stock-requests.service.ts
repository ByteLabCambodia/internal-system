import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { StockRequestEntity } from './entities/stock-request.entity';
import { StockRequestStatusEnum } from '../common/enums';
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
   * Fulfilment is trigger T4's job: it locks the item, refuses to go below zero, decrements,
   * appends the ledger row, and raises the auto-reorder PR plus its notifications when the
   * balance lands at or below the reorder point. We flip the status and re-read.
   */
  async fulfil(actor: User, id: number): Promise<void> {
    const request = await this.repository.findOne({ where: { id } });
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

    try {
      await this.repository.update(id, {
        status: StockRequestStatusEnum.fulfilled,
        fulfilledBy: { id: Number(actor.id) } as never,
      });
    } catch (error) {
      // "insufficient stock for SKU-1: 5.0000 on hand, 999.0000 requested"
      if (error instanceof QueryFailedError) {
        throw new UnprocessableEntityException(
          (error as QueryFailedError & { driverError?: { message?: string } })
            .driverError?.message ?? error.message,
        );
      }
      throw error;
    }

    await this.activity.log({
      entityType: 'stock_request',
      entityId: id,
      action: 'fulfilled',
      actorId: Number(actor.id),
    });
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
