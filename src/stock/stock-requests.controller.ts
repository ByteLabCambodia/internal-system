import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { StockRequestsService } from './stock-requests.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateStockRequestDto } from './dto/create-stock-request.dto';
import { StockPriorityEnum, StockRequestStatusEnum } from '../common/enums';
import { ActivityService } from '../activity/activity.service';
import { OrgService } from '../org/org.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { csvResponse } from '../common/web/csv';
import { buildBaseQuery } from '../procurement/purchase-requests.controller';

@Controller('stock-requests')
export class StockRequestsController {
  constructor(
    private readonly service: StockRequestsService,
    private readonly inventory: InventoryService,
    private readonly org: OrgService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  private parseFilters(query: Record<string, string | undefined>) {
    return {
      status: query.status as StockRequestStatusEnum | undefined,
      page: Math.max(1, Number(query.page) || 1),
      limit: 20,
    };
  }

  @Get()
  async list(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = this.parseFilters(query);

    const { rows, count } = await this.service.list(
      response.locals.currentUser,
      filters,
    );

    return response.render('stock/request-list', {
      title: 'Stock Requests',
      primaryAction: { href: '/stock-requests/new', label: 'Request stock' },
      rows,
      count,
      filters,
      statuses: Object.values(StockRequestStatusEnum),
      baseQuery: buildBaseQuery(query, ['page']),
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const { rows } = await this.service.list(response.locals.currentUser, {
      ...this.parseFilters(query),
      page: 1,
      limit: 10_000,
    });

    return csvResponse(
      response,
      'stock-requests.csv',
      [
        'Item',
        'Qty',
        'Priority',
        'Status',
        'Requester',
        'Department',
        'Created',
      ],
      rows.map((row) => [
        row.inventoryItem?.name ?? '',
        row.qty,
        row.priority,
        row.status,
        [row.requester?.firstName, row.requester?.lastName]
          .filter(Boolean)
          .join(' '),
        row.department ?? '',
        row.createdAt.toISOString(),
      ]),
    );
  }

  @RequirePermission(PermissionEnum['stock.request'])
  @Get('new')
  async newForm(@Res() response: Response) {
    return response.render('stock/request-form', {
      title: 'Request stock',
      items: await this.inventory.findActive(),
      departments: await this.org.findActiveDepartments(),
      priorities: Object.values(StockPriorityEnum),
      values: {},
      errors: {},
    });
  }

  @RequirePermission(PermissionEnum['stock.request'])
  @Post()
  async create(@Body() body: CreateStockRequestDto, @Res() response: Response) {
    const form = await validateForm(CreateStockRequestDto, body);

    if (!form.ok) {
      return response.status(422).render('stock/request-form', {
        title: 'Request stock',
        items: await this.inventory.findActive(),
        departments: await this.org.findActiveDepartments(),
        priorities: Object.values(StockPriorityEnum),
        values: body,
        errors: form.errors,
      });
    }

    const request = await this.service.create(
      response.locals.currentUser,
      form.data,
    );

    await this.notifications.notify('stock_request_submitted', {
      stockRequestId: request.id,
      quantity: request.qty,
      requester: [
        response.locals.currentUser.firstName,
        response.locals.currentUser.lastName,
      ]
        .filter(Boolean)
        .join(' '),
    });

    setFlash(response, 'success', 'Stock request submitted.');
    return response.redirect(`/stock-requests/${request.id}`);
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const request = await this.service.findOneForActor(
      response.locals.currentUser,
      id,
    );

    return response.render('stock/request-detail', {
      title: `Stock request #${request.id}`,
      request,
      events: await this.activity.timelineFor('stock_request', id),
    });
  }

  @RequirePermission(PermissionEnum['stock.fulfil'])
  @Post(':id/approve')
  async approve(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.approve(response.locals.currentUser, id);
      setFlash(response, 'success', 'Stock request approved.');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/stock-requests/${id}`);
  }

  /** Fulfilment moves stock and can trigger the auto-reorder PR (trigger T4). */
  @RequirePermission(PermissionEnum['stock.fulfil'])
  @Post(':id/fulfil')
  async fulfil(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.fulfil(response.locals.currentUser, id);
      setFlash(response, 'success', 'Stock issued and the ledger updated.');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/stock-requests/${id}`);
  }

  @RequirePermission(PermissionEnum['stock.fulfil'])
  @Post(':id/reject')
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.reject(response.locals.currentUser, id);
      setFlash(response, 'success', 'Stock request rejected.');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/stock-requests/${id}`);
  }
}
