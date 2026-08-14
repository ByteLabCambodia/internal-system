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
import { ClaimsService } from './claims.service';
import { InventoryService } from './inventory.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimStatusEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { StorageService } from '../storage/storage.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { csvResponse } from '../common/web/csv';
import { buildBaseQuery } from '../procurement/purchase-requests.controller';

@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly service: ClaimsService,
    private readonly inventory: InventoryService,
    private readonly storage: StorageService,
    private readonly money: MoneyService,
    private readonly notifications: NotificationsService,
  ) {}

  private parseFilters(query: Record<string, string | undefined>) {
    return {
      status: query.status as ClaimStatusEnum | undefined,
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

    return response.render('inventory/claim-list', {
      title: 'Claims',
      primaryAction: { href: '/claims/new', label: 'Claim goods' },
      rows,
      count,
      filters,
      statuses: Object.values(ClaimStatusEnum),
      money: this.money,
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
      'claims.csv',
      [
        'Item',
        'PO Number',
        'Qty claimed',
        'Status',
        'Claimed by',
        'Confirmed by',
        'Created',
      ],
      rows.map((row) => [
        row.inventoryItem?.name ?? '',
        row.purchaseOrder?.poNumber ?? '',
        row.qtyClaimed,
        row.status,
        [row.claimedBy?.firstName, row.claimedBy?.lastName]
          .filter(Boolean)
          .join(' '),
        [row.confirmedBy?.firstName, row.confirmedBy?.lastName]
          .filter(Boolean)
          .join(' '),
        row.createdAt.toISOString(),
      ]),
    );
  }

  @RequirePermission(PermissionEnum['claim.submit'])
  @Get('new')
  async newForm(@Res() response: Response) {
    return response.render('inventory/claim-form', {
      title: 'Claim goods received',
      lines: await this.service.claimableLines(),
      items: await this.inventory.findActive(),
      storageEnabled: this.storage.isConfigured,
      values: {},
      errors: {},
    });
  }

  @RequirePermission(PermissionEnum['claim.submit'])
  @Post()
  async create(@Body() body: CreateClaimDto, @Res() response: Response) {
    const form = await validateForm(CreateClaimDto, body);

    const rerender = async (errors: Record<string, string>, alert?: string) =>
      response.status(422).render('inventory/claim-form', {
        title: 'Claim goods received',
        lines: await this.service.claimableLines(),
        items: await this.inventory.findActive(),
        storageEnabled: this.storage.isConfigured,
        values: body,
        errors,
        alert,
      });

    if (!form.ok) return rerender(form.errors);

    try {
      const claim = await this.service.create(
        response.locals.currentUser,
        form.data,
      );

      await this.notifications.notify('claim_submitted', {
        claimId: claim.id,
        quantity: claim.qtyClaimed,
        requester: [
          response.locals.currentUser.firstName,
          response.locals.currentUser.lastName,
        ]
          .filter(Boolean)
          .join(' '),
      });

      setFlash(
        response,
        'success',
        'Claim submitted. A manager confirms it before stock moves.',
      );
      return response.redirect('/claims');
    } catch (error) {
      return rerender({}, (error as Error).message);
    }
  }

  @RequirePermission(PermissionEnum['claim.confirm'])
  @Post(':id/confirm')
  async confirm(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      const claim = await this.service.findOneForActor(
        response.locals.currentUser,
        id,
      );
      await this.service.confirm(response.locals.currentUser, id);

      await this.notifications.notify('claim_confirmed', {
        recipientIds: claim.claimedBy ? [Number(claim.claimedBy.id)] : [],
        claimId: id,
        item: claim.inventoryItem?.name,
        quantity: claim.qtyClaimed,
        actor: [
          response.locals.currentUser.firstName,
          response.locals.currentUser.lastName,
        ]
          .filter(Boolean)
          .join(' '),
      });

      setFlash(
        response,
        'success',
        'Claim confirmed — stock updated and the order line advanced.',
      );
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect('/claims');
  }

  @RequirePermission(PermissionEnum['claim.confirm'])
  @Post(':id/reject')
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.reject(response.locals.currentUser, id);
      setFlash(response, 'success', 'Claim rejected.');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect('/claims');
  }
}
