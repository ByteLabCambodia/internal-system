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
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PaymentsService } from './payments.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { PoStatusEnum, PoTypeEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { ActivityService } from '../activity/activity.service';
import { AccountsService } from '../accounting/accounts.service';
import { SuppliersService } from '../org/suppliers.service';
import { StorageService } from '../storage/storage.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { csvResponse } from '../common/web/csv';
import { FLOW_STEPS, flowIndex } from './support/flow-stepper';
import { buildPaymentLink } from './support/payment-link';
import { buildBaseQuery } from './purchase-requests.controller';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly service: PurchaseOrdersService,
    private readonly requests: PurchaseRequestsService,
    private readonly payments: PaymentsService,
    private readonly suppliers: SuppliersService,
    private readonly accounts: AccountsService,
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
    private readonly money: MoneyService,
    private readonly notifications: NotificationsService,
  ) {}

  private parseFilters(query: Record<string, string | undefined>) {
    return {
      status: query.status as PoStatusEnum | undefined,
      search: query.search || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      page: Math.max(1, Number(query.page) || 1),
      limit: 20,
      orderBy: query.orderBy,
      order: (query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
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

    return response.render('procurement/po-list', {
      title: 'Purchase Orders',
      primaryAction: response.locals.can['po.create']
        ? { href: '/purchase-orders/new', label: 'New order' }
        : null,
      rows,
      count,
      filters,
      statuses: Object.values(PoStatusEnum),
      money: this.money,
      baseQuery: buildBaseQuery(query, ['page', 'orderBy', 'order']),
      sortQuery: buildBaseQuery(query, ['orderBy', 'order']),
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = { ...this.parseFilters(query), page: 1, limit: 10_000 };
    const { rows } = await this.service.list(
      response.locals.currentUser,
      filters,
    );

    return csvResponse(
      response,
      'purchase-orders.csv',
      [
        'Number',
        'Status',
        'Payment status',
        'Supplier',
        'Currency',
        'Rate',
        'Total',
        'Total USD',
        'Created',
      ],
      rows.map((row) => [
        row.poNumber,
        row.status,
        row.paymentStatus,
        row.supplier?.name ?? row.supplierName ?? '',
        row.currency,
        row.exchangeRate,
        row.totalOriginal,
        row.totalUsd,
        row.createdAt.toISOString(),
      ]),
    );
  }

  @RequirePermission(PermissionEnum['po.create'])
  @Get('new')
  async newForm(@Res() response: Response, @Query('prId') prId?: string) {
    const convertible = await this.requests.findConvertible();
    const selected = prId
      ? convertible.find((pr) => pr.id === Number(prId))
      : undefined;

    return response.render('procurement/po-form', {
      title: 'New purchase order',
      convertible,
      selected,
      suppliers: await this.suppliers.findActive(),
      expenseAccounts: await this.accounts.findExpenseAccounts(),
      types: Object.values(PoTypeEnum),
      money: this.money,
      values: {},
      errors: {},
    });
  }

  @RequirePermission(PermissionEnum['po.create'])
  @Post()
  async create(
    @Body() body: CreatePurchaseOrderDto,
    @Res() response: Response,
  ) {
    const form = await validateForm(CreatePurchaseOrderDto, body);

    const rerender = async (errors: Record<string, string>, alert?: string) => {
      const convertible = await this.requests.findConvertible();
      return response.status(422).render('procurement/po-form', {
        title: 'New purchase order',
        convertible,
        selected: convertible.find((pr) => pr.id === Number(body?.prId)),
        suppliers: await this.suppliers.findActive(),
        expenseAccounts: await this.accounts.findExpenseAccounts(),
        types: Object.values(PoTypeEnum),
        money: this.money,
        values: body,
        errors,
        alert,
      });
    };

    if (!form.ok) return rerender(form.errors);

    try {
      const po = await this.service.createFromRequest(
        response.locals.currentUser,
        form.data,
      );

      await this.notifications.notify('po_created', {
        purchaseOrderId: po.id,
        number: po.poNumber,
        supplier: po.supplier?.name ?? po.supplierName,
        amount: `${po.totalOriginal} ${po.currency}`,
      });

      setFlash(response, 'success', `${po.poNumber} created.`);
      return response.redirect(`/purchase-orders/${po.id}`);
    } catch (error) {
      return rerender({}, (error as Error).message);
    }
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const po = await this.service.findOneForActor(
      response.locals.currentUser,
      id,
    );
    const payments = await this.payments.listForOrder(id);

    // Short-lived view URLs so receipts render without making the bucket public.
    const receiptUrls: Record<number, string | null> = {};
    for (const payment of payments) {
      if (payment.receiptObjectKey) {
        receiptUrls[payment.id] = await this.storage.createViewUrl(
          payment.receiptObjectKey,
        );
      }
    }

    // Payment destination lives on the requester's profile (saved once, reused).
    const payTo = po.purchaseRequest?.requester ?? null;
    const payToLink = payTo?.paymentLink
      ? buildPaymentLink(
          payTo.paymentLink,
          Number(po.totalOriginal),
          po.currency,
        )
      : null;

    return response.render('procurement/po-detail', {
      title: po.poNumber,
      po,
      payments,
      receiptUrls,
      payTo,
      payToLink,
      paidUsd: this.money.sum(payments.map((payment) => payment.amountUsd)),
      money: this.money,
      steps: FLOW_STEPS,
      currentStep: flowIndex({
        poStatus: po.status,
        paymentStatus: po.paymentStatus,
      }),
      events: await this.activity.timelineFor('purchase_order', id),
    });
  }

  @RequirePermission(PermissionEnum['po.cancel'])
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.cancel(response.locals.currentUser, id);
      setFlash(response, 'success', 'Purchase order cancelled.');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/purchase-orders/${id}`);
  }
}
