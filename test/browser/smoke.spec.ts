import { expect, test } from '@playwright/test';
import { login, sql } from './support';

/**
 * Every screen and export, opened as an admin once the other specs have filled the
 * database. Catches a page whose query or template breaks without a dedicated test.
 * Runs last (alphabetically), so the detail pages have rows to show.
 */
const REPORTS = [
  'profit-and-loss',
  'cash-flow',
  'expense-by-category',
  'expense-by-department',
  'currency-summary',
  'po-summary',
  'transaction-history',
  'budget-vs-actual',
  'spend-by-supplier',
];

async function firstId(table: string): Promise<string> {
  const [row] = await sql(`SELECT id FROM ${table} ORDER BY id LIMIT 1`);
  expect(row, `${table} has a row`).toBeDefined();
  return String(row.id);
}

test('should open every page and export without an error', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');

  const pages = [
    '/dashboard',
    '/profile',
    '/purchase-requests',
    '/purchase-requests?search=paper&status=approved&orderBy=total_usd&order=asc',
    '/purchase-requests/new',
    `/purchase-requests/${await firstId('purchase_requests')}`,
    '/purchase-orders',
    '/purchase-orders?search=acme&from=2020-01-01&to=2099-12-31',
    '/purchase-orders/new',
    `/purchase-orders/${await firstId('purchase_orders')}`,
    '/accounting',
    '/accounting/accounts',
    '/accounting/income',
    '/accounting/rates',
    '/accounting/payments/new',
    '/reports',
    ...REPORTS.map((key) => `/reports/${key}?from=2020-01-01`),
    '/claims',
    '/claims/new',
    '/inventory',
    '/inventory?search=paper&lowStock=true&orderBy=stock_qty&order=desc',
    '/inventory/new',
    '/inventory/categories',
    `/inventory/categories/${await firstId('categories')}/edit`,
    `/inventory/${await firstId('inventory_items')}`,
    `/inventory/${await firstId('inventory_items')}/edit`,
    '/stock-requests',
    '/stock-requests/new',
    `/stock-requests/${await firstId('stock_requests')}`,
    '/admin',
    '/admin/users',
    '/admin/org',
    '/admin/settings',
    '/admin/suppliers',
  ];

  for (const url of pages) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(200);
    await expect(page.locator('body'), url).not.toContainText(
      /Internal server error|Cannot read properties|is not a function/i,
    );
  }

  const exports = [
    '/purchase-requests/export.csv',
    '/purchase-orders/export.csv',
    '/claims/export.csv',
    '/inventory/export.csv',
    '/stock-requests/export.csv',
    ...REPORTS.map((key) => `/reports/${key}/export.csv`),
  ];

  for (const url of exports) {
    const response = await page.request.get(url);
    expect(response.status(), url).toBe(200);
    const body = await response.text();
    expect(body.split('\n').length, url).toBeGreaterThan(0);
    expect(body, url).not.toContain('[object Object]');
  }
});
