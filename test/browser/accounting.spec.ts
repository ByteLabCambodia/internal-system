import { expect, test } from '@playwright/test';
import { login, sql, submit } from './support';

/**
 * Accounting, reports and the dashboard, read through Prisma: rates, manual income and
 * the journal, a report built from it, the dashboard feed, and an order whose supplier is
 * legacy free text (the case a relation/column name clash once blanked out).
 */
test.describe.configure({ mode: 'serial' });

test.describe('accounting, reports and dashboard', () => {
  test('should save a manual rate and show it as current', async ({ page }) => {
    await login(page, 'finance');
    await page.goto('/accounting/rates');
    await page.getByLabel('Date').fill('2026-01-05');
    await page.locator('#currency').selectOption('CNY');
    await page.getByLabel('Units per 1 USD').fill('7.25');
    await submit(page, 'Save rate');

    await expect(page).toHaveURL(/\/accounting\/rates$/);
    await expect(page.getByRole('cell', { name: '7.25' })).toBeVisible();

    const rows = await sql(
      `SELECT rate_to_usd, source FROM exchange_rates WHERE currency = 'CNY' AND rate_date = '2026-01-05'`,
    );
    expect(rows).toEqual([{ rate_to_usd: '7.250000', source: 'manual' }]);
  });

  test('should record income and list it in the journal with both lines', async ({
    page,
  }) => {
    await login(page, 'finance');
    await page.goto('/accounting/income');
    await page.getByLabel('Amount').fill('125');
    await page.locator('#incomeAccountId').selectOption({ index: 1 });
    await page.getByLabel('Entry date').fill('2026-01-20');
    await page.getByLabel('Memo').fill('Workshop fees');
    await submit(page, 'Record income');

    await expect(page).toHaveURL(/\/accounting$/);
    const entry = page.locator('div.overflow-hidden', {
      hasText: 'Workshop fees',
    });
    await expect(entry).toContainText('2026-01-20');
    await expect(entry).toContainText('1000 Cash / Bank');
    await expect(entry).toContainText('manual income');

    // The date filter keeps it in January and drops it from February.
    await page.goto('/accounting?from=2026-02-01&to=2026-02-28');
    await expect(page.getByText('Workshop fees')).toHaveCount(0);
    await page.goto('/accounting?from=2026-01-20&to=2026-01-20');
    await expect(page.getByText('Workshop fees')).toBeVisible();
  });

  test('should show that income in the profit and loss report for its month', async ({
    page,
  }) => {
    await login(page, 'finance');
    await page.goto('/reports/profit-and-loss?from=2026-01-01&to=2026-01-31');

    const january = page.getByRole('row', { name: /2026-01/ });
    await expect(january).toContainText('125.00');
  });

  test('should list and show an order whose supplier is only free text', async ({
    page,
  }) => {
    const [po] = await sql(
      `INSERT INTO purchase_orders (supplier, total_original, total_usd)
       VALUES ('Legacy Stationers', 12, 12) RETURNING id, po_number`,
    );

    await login(page, 'manager');
    await page.goto('/purchase-orders');
    await expect(
      page.getByRole('row', { name: new RegExp(po.po_number) }),
    ).toContainText('Legacy Stationers');

    await page.goto(`/purchase-orders/${po.id}`);
    await expect(page.getByText('Legacy Stationers')).toBeVisible();

    await page.goto('/purchase-orders?search=legacy');
    await expect(page.getByRole('cell', { name: po.po_number })).toBeVisible();
  });

  test('should show recent activity on the dashboard', async ({ page }) => {
    await login(page, 'manager');
    await page.goto('/dashboard');

    await expect(page.getByText('Legacy Stationers').first()).toBeVisible();
    await expect(page.getByText('Open purchase orders')).toBeVisible();
  });
});
