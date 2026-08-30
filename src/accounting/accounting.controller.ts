import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { JournalService } from './journal.service';
import { AccountsService } from './accounts.service';
import { RatesService } from './rates.service';
import { RecordIncomeDto } from './dto/record-income.dto';
import { ExchangeRateDto } from './dto/exchange-rate.dto';
import { CurrencyEnum } from '../common/enums';
import { MoneyService } from '../common/money/money.service';
import { OrgService } from '../org/org.service';
import { PermissionEnum } from '../permissions/permissions.enum';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { setFlash } from '../common/web/flash';
import { validateForm } from '../common/web/validate-form';

@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly journal: JournalService,
    private readonly accounts: AccountsService,
    private readonly rates: RatesService,
    private readonly org: OrgService,
    private readonly money: MoneyService,
    private readonly notifications: NotificationsService,
  ) {}

  @RequirePermission(PermissionEnum['accounting.view'])
  @Get()
  async overview(
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = {
      from: query.from || undefined,
      to: query.to || undefined,
      page: Math.max(1, Number(query.page) || 1),
      limit: 25,
    };

    const { rows, count } = await this.journal.list(filters);

    return response.render('accounting/overview', {
      title: 'Accounting',
      primaryAction: response.locals.can['income.add']
        ? { href: '/accounting/income', label: 'Record income' }
        : null,
      entries: rows,
      count,
      filters,
      cashBalance: await this.journal.cashBalance(),
      expenseThisMonth: await this.journal.expenseThisMonth(),
      money: this.money,
      baseQuery: '',
    });
  }

  @RequirePermission(PermissionEnum['accounting.view'])
  @Get('accounts')
  async chartOfAccounts(@Res() response: Response) {
    return response.render('accounting/accounts', {
      title: 'Chart of accounts',
      rows: await this.accounts.findAll(),
    });
  }

  // --- manual income -------------------------------------------------------------------
  @RequirePermission(PermissionEnum['income.add'])
  @Get('income')
  async incomeForm(@Res() response: Response) {
    return response.render('accounting/income-form', {
      title: 'Record income',
      incomeAccounts: await this.journal.findIncomeAccounts(),
      departments: await this.org.findActiveDepartments(),
      projects: await this.org.findActiveProjects(),
      currencies: Object.values(CurrencyEnum),
      rates: await this.rates.currentRates(),
      values: {},
      errors: {},
    });
  }

  @RequirePermission(PermissionEnum['income.add'])
  @Post('income')
  async recordIncome(@Body() body: RecordIncomeDto, @Res() response: Response) {
    const form = await validateForm(RecordIncomeDto, body);

    const rerender = async (errors: Record<string, string>, alert?: string) =>
      response.status(422).render('accounting/income-form', {
        title: 'Record income',
        incomeAccounts: await this.journal.findIncomeAccounts(),
        departments: await this.org.findActiveDepartments(),
        projects: await this.org.findActiveProjects(),
        currencies: Object.values(CurrencyEnum),
        rates: await this.rates.currentRates(),
        values: body,
        errors,
        alert,
      });

    if (!form.ok) return rerender(form.errors);

    try {
      await this.journal.recordIncome(response.locals.currentUser, form.data);
      setFlash(
        response,
        'success',
        'Income recorded and posted to the ledger.',
      );
      return response.redirect('/accounting');
    } catch (error) {
      return rerender({}, (error as Error).message);
    }
  }

  // --- exchange rates ------------------------------------------------------------------
  @RequirePermission(PermissionEnum['accounting.view'])
  @Get('rates')
  async ratesPage(@Res() response: Response) {
    return response.render('accounting/rates', {
      title: 'Exchange rates',
      rows: await this.rates.history(),
      current: await this.rates.currentRates(),
      currencies: Object.values(CurrencyEnum).filter(
        (currency) => currency !== CurrencyEnum.USD,
      ),
      values: { rateDate: new Date().toISOString().slice(0, 10) },
      errors: {},
    });
  }

  @RequirePermission(PermissionEnum['rate.override'])
  @Post('rates')
  async setRate(@Body() body: ExchangeRateDto, @Res() response: Response) {
    const form = await validateForm(ExchangeRateDto, body);

    if (!form.ok) {
      return response.status(422).render('accounting/rates', {
        title: 'Exchange rates',
        rows: await this.rates.history(),
        current: await this.rates.currentRates(),
        currencies: Object.values(CurrencyEnum).filter(
          (currency) => currency !== CurrencyEnum.USD,
        ),
        values: body,
        errors: form.errors,
      });
    }

    await this.rates.setManualRate(form.data);

    await this.notifications.notify('exchange_rate_updated', {
      currency: form.data.currency,
      amount: `${form.data.rateToUsd} per USD`,
      note: `for ${form.data.rateDate}`,
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
      `${form.data.currency} set to ${form.data.rateToUsd} per USD for ${form.data.rateDate}.`,
    );

    return response.redirect('/accounting/rates');
  }
}
