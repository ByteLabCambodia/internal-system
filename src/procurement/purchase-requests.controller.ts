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
import { PurchaseRequestsService } from './purchase-requests.service';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { CurrencyEnum, PrStatusEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { ActivityService } from '../activity/activity.service';
import { RatesService } from '../accounting/rates.service';
import { OrgService } from '../org/org.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';
import { FLOW_STEPS, flowIndex } from './support/flow-stepper';
import { csvResponse } from '../common/web/csv';

@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(
    private readonly service: PurchaseRequestsService,
    private readonly org: OrgService,
    private readonly rates: RatesService,
    private readonly activity: ActivityService,
    private readonly money: MoneyService,
    private readonly notifications: NotificationsService,
  ) {}

  private parseFilters(query: Record<string, string | undefined>) {
    return {
      status: query.status as PrStatusEnum | undefined,
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

    return response.render('procurement/pr-list', {
      title: 'Purchase Requests',
      primaryAction: { href: '/purchase-requests/new', label: 'New request' },
      rows,
      count,
      filters,
      statuses: Object.values(PrStatusEnum),
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
      'purchase-requests.csv',
      [
        'Number',
        'Status',
        'Requester',
        'Department',
        'Currency',
        'Rate',
        'Total',
        'Total USD',
        'Created',
      ],
      rows.map((row) => [
        row.prNumber,
        row.status,
        [row.requester?.firstName, row.requester?.lastName]
          .filter(Boolean)
          .join(' '),
        row.department?.name ?? '',
        row.currency,
        row.exchangeRate,
        row.totalOriginal,
        row.totalUsd,
        row.createdAt.toISOString(),
      ]),
    );
  }

  @RequirePermission(PermissionEnum['pr.create'])
  @Get('new')
  async newForm(@Res() response: Response) {
    return response.render('procurement/pr-form', {
      title: 'New purchase request',
      departments: await this.org.findActiveDepartments(),
      projects: await this.org.findActiveProjects(),
      rates: await this.rates.currentRates(),
      currencies: Object.values(CurrencyEnum),
      values: {},
      errors: {},
    });
  }

  @RequirePermission(PermissionEnum['pr.create'])
  @Post()
  async create(
    @Body() body: CreatePurchaseRequestDto & { intent?: string },
    @Res() response: Response,
  ) {
    const form = await validateForm(CreatePurchaseRequestDto, body);

    if (!form.ok) {
      // Re-render with the submitted values, never an empty form.
      return response.status(422).render('procurement/pr-form', {
        title: 'New purchase request',
        departments: await this.org.findActiveDepartments(),
        projects: await this.org.findActiveProjects(),
        rates: await this.rates.currentRates(),
        currencies: Object.values(CurrencyEnum),
        values: body,
        errors: form.errors,
      });
    }

    const submit = body.intent !== 'draft';

    try {
      const pr = await this.service.create(
        response.locals.currentUser,
        form.data,
        submit,
      );

      if (submit) {
        await this.notifications.notify('pr_created', {
          purchaseRequestId: pr.id,
          number: pr.prNumber,
          requester: [pr.requester.firstName, pr.requester.lastName]
            .filter(Boolean)
            .join(' '),
          amount: `${pr.totalOriginal} ${pr.currency}`,
          note: pr.note,
        });
      }

      setFlash(
        response,
        'success',
        `${pr.prNumber} ${submit ? 'submitted for approval' : 'saved as a draft'}.`,
      );
      return response.redirect(`/purchase-requests/${pr.id}`);
    } catch (error) {
      return response.status(422).render('procurement/pr-form', {
        title: 'New purchase request',
        departments: await this.org.findActiveDepartments(),
        projects: await this.org.findActiveProjects(),
        rates: await this.rates.currentRates(),
        currencies: Object.values(CurrencyEnum),
        values: body,
        errors: {},
        alert: (error as Error).message,
      });
    }
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const pr = await this.service.findOneForActor(
      response.locals.currentUser,
      id,
    );

    return response.render('procurement/pr-detail', {
      title: pr.prNumber,
      pr,
      money: this.money,
      steps: FLOW_STEPS,
      currentStep: flowIndex({ prStatus: pr.status }),
      events: await this.activity.timelineFor('purchase_request', id),
      isOwnRequest:
        Number(pr.requester.id) === Number(response.locals.currentUser.id),
    });
  }

  @Post(':id/submit')
  async submit(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      const pr = await this.service.submit(response.locals.currentUser, id);

      await this.notifications.notify('pr_created', {
        purchaseRequestId: pr.id,
        number: pr.prNumber,
        requester: [pr.requester.firstName, pr.requester.lastName]
          .filter(Boolean)
          .join(' '),
        amount: `${pr.totalOriginal} ${pr.currency}`,
      });

      setFlash(response, 'success', `${pr.prNumber} submitted for approval.`);
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/purchase-requests/${id}`);
  }

  @RequirePermission(PermissionEnum['pr.decide'])
  @Post(':id/decide')
  async decide(
    @Param('id', ParseIntPipe) id: number,
    @Body('decision') decision: string,
    @Res() response: Response,
  ) {
    try {
      const pr = await this.service.decide(
        response.locals.currentUser,
        id,
        decision === 'reject' ? 'rejected' : 'approved',
      );
      await this.notifications.notify('pr_decided', {
        recipientIds: [Number(pr.requester.id)],
        purchaseRequestId: pr.id,
        number: pr.prNumber,
        decision: pr.status,
        actor: [
          response.locals.currentUser.firstName,
          response.locals.currentUser.lastName,
        ]
          .filter(Boolean)
          .join(' '),
      });

      setFlash(response, 'success', `${pr.prNumber} ${pr.status}.`);
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/purchase-requests/${id}`);
  }

  @RequirePermission(PermissionEnum['pr.cancel'])
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.cancel(response.locals.currentUser, id);
      setFlash(response, 'success', 'Purchase request cancelled.');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
    }

    return response.redirect(`/purchase-requests/${id}`);
  }

  @RequirePermission(PermissionEnum['pr.delete'])
  @Post(':id/delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    try {
      await this.service.remove(response.locals.currentUser, id);
      setFlash(response, 'success', 'Purchase request deleted.');
      return response.redirect('/purchase-requests');
    } catch (error) {
      setFlash(response, 'error', (error as Error).message);
      return response.redirect(`/purchase-requests/${id}`);
    }
  }
}

/** Rebuilds the query string minus the keys the caller is about to set. */
export function buildBaseQuery(
  query: Record<string, string | undefined>,
  omit: string[],
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value && !omit.includes(key)) params.set(key, value);
  }

  const encoded = params.toString();
  return encoded ? `${encoded}&` : '';
}
