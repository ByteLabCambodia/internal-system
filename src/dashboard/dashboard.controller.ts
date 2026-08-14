import { Controller, Get, Render, Res } from '@nestjs/common';
import { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { JournalService } from '../accounting/journal.service';
import { MoneyService } from '../common/money/money.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';

@Controller()
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly journal: JournalService,
    private readonly money: MoneyService,
  ) {}

  @Get()
  root(@Res() response: Response) {
    return response.redirect('/dashboard');
  }

  @Get('dashboard')
  async dashboard(@Res() response: Response) {
    const actor = response.locals.currentUser;
    const canSeeAccounting = response.locals.can['accounting.view'];

    return response.render('pages/dashboard', {
      title: 'Dashboard',
      primaryAction: { href: '/purchase-requests/new', label: 'New request' },
      kpis: await this.service.kpis(actor),
      // Accounting figures are only fetched for the roles allowed to see them.
      cashBalance: canSeeAccounting ? await this.journal.cashBalance() : null,
      expenseThisMonth: canSeeAccounting
        ? await this.journal.expenseThisMonth()
        : null,
      pendingApprovals: response.locals.can['pr.decide']
        ? await this.service.pendingApprovals()
        : null,
      charts: canSeeAccounting ? await this.service.charts() : null,
      feed: await this.service.activityFeed(),
      notifications: await this.service.notifications(actor),
      money: this.money,
    });
  }

  @RequirePermission(PermissionEnum['users.manage'])
  @Get('admin/ui-kit')
  @Render('pages/ui-kit')
  uiKit() {
    return { title: 'UI kit' };
  }
}
