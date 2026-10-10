import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestApp, resetData } from './support/test-app';
import {
  q,
  seedPurchaseOrder,
  seedRoles,
  seedWorld,
  World,
} from './support/fixtures';
import { RatesService } from '../../src/accounting/rates.service';
import { JournalService } from '../../src/accounting/journal.service';
import { ReportsService } from '../../src/accounting/reports.service';
import { PaymentsService } from '../../src/procurement/payments.service';
import { DashboardService } from '../../src/dashboard/dashboard.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { CurrencyEnum } from '../../src/common/enums';

/**
 * Exchange rates, the journal, the reports and the dashboard after the move to Prisma.
 * The reports and dashboard charts are raw SQL through Prisma's raw lane, so these pin
 * their figures and their date filtering.
 */
describe('accounting, reports and dashboard on Prisma', () => {
  let app: TestingModule;
  let db: DataSource;
  let world: World;
  let salesId: number;
  let thisMonth: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetData(db);
    await seedRoles(db);
    world = await seedWorld(db);
    salesId = (
      await q(
        db,
        `INSERT INTO accounts (code, name, type) VALUES ('4000', 'Sales', 'income') RETURNING id`,
      )
    ).id;
    await db.query(
      `INSERT INTO accounts (code, name, type, active) VALUES ('4900', 'Old income', 'income', false)`,
    );
    thisMonth = (await q(db, `SELECT to_char(current_date, 'YYYY-MM') AS m`)).m;
  });

  describe('RatesService', () => {
    let rates: RatesService;
    beforeEach(() => (rates = app.get(RatesService)));

    it('should upsert one manual rate per day and currency', async () => {
      await rates.setManualRate({
        rateDate: '2026-01-05',
        currency: CurrencyEnum.CNY,
        rateToUsd: 7.1,
      });
      await db.query(
        `UPDATE exchange_rates SET source = 'api' WHERE currency = 'CNY'`,
      );
      await rates.setManualRate({
        rateDate: '2026-01-05',
        currency: CurrencyEnum.CNY,
        rateToUsd: 7.25,
      });

      expect(
        await db.query(
          `SELECT rate_date::text, rate_to_usd, source FROM exchange_rates WHERE currency = 'CNY'`,
        ),
      ).toEqual([
        { rate_date: '2026-01-05', rate_to_usd: '7.250000', source: 'manual' },
      ]);
    });

    it('should use the latest rate on or before today, never a future one', async () => {
      await db.query(
        `INSERT INTO exchange_rates (rate_date, currency, rate_to_usd) VALUES
           (current_date - 3, 'CNY', 7.0), (current_date - 1, 'CNY', 7.2),
           (current_date + 1, 'CNY', 9.9)`,
      );

      expect(await rates.getCurrentRate(CurrencyEnum.CNY)).toBe('7.200000');
      expect(await rates.getCurrentRate(CurrencyEnum.USD)).toBe('1.000000');
      expect(await rates.currentRates()).toEqual({
        USD: '1.000000',
        KHR: '4000.000000',
        CNY: '7.200000',
      });

      await db.query(`DELETE FROM exchange_rates WHERE currency = 'CNY'`);
      expect(await rates.getCurrentRate(CurrencyEnum.CNY)).toBeNull();
    });

    it('should list history newest day first, then by currency', async () => {
      await db.query(
        `INSERT INTO exchange_rates (rate_date, currency, rate_to_usd) VALUES
           (current_date, 'CNY', 7), (current_date - 1, 'KHR', 4100)`,
      );

      const history = await rates.history(2);
      // Currency sorts in the enum's declared order (USD, KHR, CNY), not alphabetically.
      expect(history.map((r) => [r.currency, r.rateToUsd])).toEqual([
        ['KHR', '4000.000000'],
        ['CNY', '7.000000'],
      ]);
    });
  });

  describe('JournalService', () => {
    let journal: JournalService;
    beforeEach(() => (journal = app.get(JournalService)));

    const income = (amount: number, extra = {}) =>
      journal.recordIncome(world.finance, {
        amountOriginal: amount,
        currency: CurrencyEnum.USD,
        incomeAccountId: salesId,
        ...extra,
      } as never);

    it('should book income as DR cash / CR income at the locked rate, with dimensions', async () => {
      const id = await income(40000, {
        currency: CurrencyEnum.KHR,
        departmentId: world.departmentId,
        memo: 'Event tickets',
      });

      const entry = await q(
        db,
        `SELECT memo, currency, exchange_rate, source, created_by FROM journal_entries WHERE id = $1`,
        [id],
      );
      expect(entry).toEqual({
        memo: 'Event tickets',
        currency: 'KHR',
        exchange_rate: '4000.000000',
        source: 'manual_income',
        created_by: world.finance.id,
      });
      expect(
        await db.query(
          `SELECT account_id, debit_usd, credit_usd, dimension_department_id, dimension_project_id
             FROM journal_lines WHERE entry_id = $1 ORDER BY id`,
          [id],
        ),
      ).toEqual([
        {
          account_id: world.accounts.cash,
          debit_usd: '10.0000',
          credit_usd: '0.0000',
          dimension_department_id: world.departmentId,
          dimension_project_id: null,
        },
        {
          account_id: salesId,
          debit_usd: '0.0000',
          credit_usd: '10.0000',
          dimension_department_id: world.departmentId,
          dimension_project_id: null,
        },
      ]);
    });

    it('should refuse a non-income account or a currency with no rate', async () => {
      await expect(
        income(5, { incomeAccountId: world.accounts.misc }),
      ).rejects.toThrow('Choose an income account.');
      await expect(income(5, { currency: CurrencyEnum.CNY })).rejects.toThrow(
        'No exchange rate on file for CNY',
      );
      expect(await db.query(`SELECT 1 FROM journal_entries`)).toHaveLength(0);
    });

    it('should offer only active income accounts', async () => {
      expect((await journal.findIncomeAccounts()).map((a) => a.code)).toEqual([
        '4000',
      ]);
    });

    it('should list entries newest first with lines, accounts and author, filtered and paged', async () => {
      await income(9, { entryDate: '2025-12-31' }); // the day before the range
      await income(1, { entryDate: '2026-01-01' });
      await income(2, { entryDate: '2026-01-15' });
      await income(3, { entryDate: '2026-01-15' });
      await income(4, { entryDate: '2026-02-01' });

      const january = await journal.list({
        from: '2026-01-01',
        to: '2026-01-31',
        page: 1,
        limit: 2,
      });
      expect(january.count).toBe(3);
      expect(january.rows.map((e) => e.lines[0].debitUsd)).toEqual([
        '3.0000',
        '2.0000',
      ]);
      expect(january.rows[0]).toMatchObject({
        entryDate: '2026-01-15',
        createdBy: { id: world.finance.id },
        lines: [
          { account: { code: '1000' }, debitUsd: '3.0000' },
          { account: { code: '4000' }, creditUsd: '3.0000' },
        ],
      });

      const rest = await journal.list({
        from: '2026-01-01',
        to: '2026-01-31',
        page: 2,
        limit: 2,
      });
      expect(rest.rows.map((e) => e.entryDate)).toEqual(['2026-01-01']);

      expect((await journal.list({ page: 1, limit: 10 })).count).toBe(5);
    });

    it('should report the cash balance and this month’s expense', async () => {
      await income(10);
      const po = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
      });
      await app.get(PaymentsService).record(world.finance, {
        poId: po.poId,
        amountOriginal: 4,
        currency: CurrencyEnum.USD,
      } as never);

      expect(await journal.cashBalance()).toBe('6.0000');
      expect(await journal.expenseThisMonth()).toBe('4.0000');
    });
  });

  describe('ReportsService', () => {
    let reports: ReportsService;

    beforeEach(async () => {
      reports = app.get(ReportsService);
      const journal = app.get(JournalService);
      const payments = app.get(PaymentsService);

      // This month: 10 of income, a 4 USD payment against an Ops order and a 1 USD direct
      // expense. Last year: 7 of income.
      await journal.recordIncome(world.finance, {
        amountOriginal: 10,
        currency: CurrencyEnum.USD,
        incomeAccountId: salesId,
      } as never);
      await journal.recordIncome(world.finance, {
        amountOriginal: 7,
        currency: CurrencyEnum.USD,
        incomeAccountId: salesId,
        entryDate: '2025-01-15',
      } as never);
      const po = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
      });
      await payments.record(world.finance, {
        poId: po.poId,
        amountOriginal: 4,
        currency: CurrencyEnum.USD,
      } as never);
      await payments.record(world.finance, {
        amountOriginal: 4000,
        currency: CurrencyEnum.KHR,
        expenseAccountId: world.accounts.supplies,
      } as never);
    });

    const rows = async (key: string, range = {}) =>
      (await reports.build(key, range))!.rows;

    it('should build every report and refuse an unknown key', async () => {
      for (const key of reports.keys) {
        const report = await reports.build(key, {});
        expect(report).toMatchObject({ key, title: expect.any(String) });
        for (const row of report!.rows) {
          expect(Object.keys(row).sort()).toEqual(
            report!.columns.map((c) => c.key).sort(),
          );
        }
      }
      expect(reports.build('nope', {})).toBeNull();
    });

    it('should total profit and loss and cash flow by month', async () => {
      expect(await rows('profit-and-loss')).toEqual([
        { month: '2025-01', income: '7.0000', expense: '0', net: '7.0000' },
        {
          month: thisMonth,
          income: '10.0000',
          expense: '5.0000',
          net: '5.0000',
        },
      ]);
      expect(await rows('cash-flow', { from: '2026-01-01' })).toEqual([
        {
          month: thisMonth,
          inflow: '10.0000',
          outflow: '5.0000',
          net: '5.0000',
        },
      ]);
    });

    it('should honour inclusive date bounds', async () => {
      expect(
        await rows('profit-and-loss', { from: '2025-01-15', to: '2025-01-15' }),
      ).toEqual([
        { month: '2025-01', income: '7.0000', expense: '0', net: '7.0000' },
      ]);
      expect(
        await rows('profit-and-loss', { from: '2025-01-16', to: '2025-12-31' }),
      ).toEqual([]);
    });

    it('should split expense by account, department, currency and supplier', async () => {
      expect(await rows('expense-by-category')).toEqual([
        { code: '6900', account: 'Miscellaneous expense', total: '4.0000' },
        { code: '6100', account: 'Office supplies', total: '1.0000' },
      ]);
      expect(await rows('expense-by-department')).toEqual([
        { department: 'Ops', total: '4.0000' },
        { department: 'Unassigned', total: '1.0000' },
      ]);
      expect(await rows('currency-summary')).toEqual([
        {
          currency: 'USD',
          payments: '1',
          total_original: '4.0000',
          total_usd: '4.0000',
        },
        {
          currency: 'KHR',
          payments: '1',
          total_original: '4000.0000',
          total_usd: '1.0000',
        },
      ]);
      expect(await rows('spend-by-supplier')).toEqual([
        {
          supplier: 'Acme',
          orders: '1',
          total_usd: '10.0000',
          last_order: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
      ]);
      expect(await rows('po-summary')).toEqual([
        {
          status: 'open',
          payment_status: 'partial',
          orders: '1',
          total_usd: '10.0000',
        },
      ]);
    });

    it('should list transactions newest first and compare budgets with actuals', async () => {
      const history = await rows('transaction-history');
      expect(history).toHaveLength(8);
      expect(history[history.length - 1]).toMatchObject({
        date: '2025-01-15',
        source: 'manual_income',
        account: '4000 Sales',
      });

      await db.query(
        `INSERT INTO budgets (department_id, period, amount_usd)
         VALUES ($1, date_trunc('month', current_date), 100)`,
        [world.departmentId],
      );
      expect(await rows('budget-vs-actual')).toEqual([
        {
          period: thisMonth,
          department: 'Ops',
          category: 'All',
          budget: '100.0000',
          actual: '4.0000',
        },
      ]);
    });
  });

  describe('DashboardService', () => {
    let dashboard: DashboardService;
    beforeEach(() => (dashboard = app.get(DashboardService)));

    it('should count the KPIs for the actor', async () => {
      await db.query(
        `INSERT INTO purchase_requests (requester_id, status) VALUES
           ($1, 'draft'), ($1, 'pending'), ($1, 'approved'), ($2, 'pending')`,
        [world.employee.id, world.manager.id],
      );
      await seedPurchaseOrder(db, world, { lines: [[null, '1', '1']] });
      await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '1']],
        status: 'partial',
      });
      await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '1']],
        status: 'complete',
      });
      // SKU-B: 0 on hand at a reorder point of 0. An inactive low item does not count.
      await db.query(
        `INSERT INTO inventory_items (sku, name, active) VALUES ('OLD', 'Old', false)`,
      );

      expect(await dashboard.kpis(world.employee)).toEqual({
        myPendingRequests: 2,
        lowStockItems: 1,
        openPurchaseOrders: 2,
      });
      expect(await dashboard.pendingApprovals()).toBe(2);
    });

    it('should chart the last twelve months and the top expense groups', async () => {
      const po = await seedPurchaseOrder(db, world, {
        lines: [[null, '1', '10']],
      });
      await app.get(PaymentsService).record(world.finance, {
        poId: po.poId,
        amountOriginal: 2.5,
        currency: CurrencyEnum.USD,
      } as never);

      expect(await dashboard.charts()).toEqual({
        profitAndLoss: { labels: [thisMonth], income: [0], expense: [2.5] },
        expenseByCategory: {
          labels: ['Miscellaneous expense'],
          values: [2.5],
        },
        expenseByDepartment: { labels: ['Ops'], values: [2.5] },
      });
    });

    it('should merge recent orders, payments, claims and stock requests newest first', async () => {
      const po = await seedPurchaseOrder(db, world, {
        lines: [[world.itemA, '5', '2']],
      });
      await db.query(
        `INSERT INTO inventory_claims (po_id, po_item_id, inventory_item_id, qty_claimed, created_at)
         VALUES ($1, $2, $3, 1.5, now() + interval '1 second')`,
        [po.poId, po.lineIds[0], world.itemA],
      );
      await db.query(
        `INSERT INTO stock_requests (requester_id, inventory_item_id, qty, created_at)
         VALUES ($1, $2, 2, now() + interval '2 seconds')`,
        [world.employee.id, world.itemB],
      );
      await db.query(
        `INSERT INTO payments (amount_original, amount_usd, created_at)
         VALUES (3, 3, now() + interval '3 seconds')`,
      );

      const feed = await dashboard.activityFeed(3);
      expect(feed).toEqual([
        {
          kind: 'Payment',
          label: 'Direct expense',
          href: '/accounting',
          detail: '3.00 USD',
          status: null,
          createdAt: expect.any(String),
        },
        {
          kind: 'Stock request',
          label: 'Item SKU-B',
          href: expect.stringMatching(/^\/stock-requests\/\d+$/),
          detail: '2 requested',
          status: 'pending',
          createdAt: expect.any(String),
        },
        {
          kind: 'Claim',
          label: 'Item SKU-A',
          href: '/claims',
          detail: '1.5 received',
          status: 'pending',
          createdAt: expect.any(String),
        },
      ]);
      expect(Number.isNaN(new Date(feed[0].createdAt).getTime())).toBe(false);
    });

    it('should show the actor’s unread notifications, newest first', async () => {
      const notifications = app.get(NotificationsService);
      await notifications.notify('pr_created', {
        recipientIds: [Number(world.manager.id)],
      });
      await notifications.notify('claim_confirmed', {
        recipientIds: [Number(world.manager.id)],
      });
      await notifications.notify('pr_decided', {
        recipientIds: [Number(world.admin.id)],
      });

      expect(
        (await dashboard.notifications(world.manager)).map((n) => n.event),
      ).toEqual(['claim_confirmed', 'pr_created']);
      expect(await dashboard.notifications(world.manager, 1)).toHaveLength(1);

      await notifications.markAllRead(Number(world.manager.id));
      expect(await dashboard.notifications(world.manager)).toEqual([]);
    });
  });
});
