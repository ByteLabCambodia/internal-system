import { expect, test } from '@playwright/test';
import { login, sql, submit } from './support';

/**
 * The admin screens behind org data: suppliers, departments/projects, and the approval
 * limits that decide which purchase requests a manager may approve.
 */
test.describe.configure({ mode: 'serial' });

test.describe('admin', () => {
  // Specs share one database: put back the seeded "managers are unlimited" limit.
  test.afterAll(async () => {
    await sql(
      `UPDATE approval_thresholds SET max_amount_usd = NULL WHERE role_id = 2`,
    );
  });

  test('should add a supplier with "Active" ticked and list it', async ({
    page,
  }) => {
    await login(page, 'manager');
    await page.goto('/admin/suppliers');
    await page.locator('#name').fill('Phnom Penh Paper Co.');
    await page.getByLabel('Phone').fill('012 345 678');
    await page.getByLabel('Payment terms (days)').fill('30');
    await submit(page, 'Add supplier');

    await expect(
      page.getByRole('cell', { name: 'Phnom Penh Paper Co.' }),
    ).toBeVisible();
    const [supplier] = await sql(
      `SELECT phone, payment_terms_days, active FROM suppliers WHERE name = 'Phnom Penh Paper Co.'`,
    );
    expect(supplier).toEqual({
      phone: '012 345 678',
      payment_terms_days: 30,
      active: true,
    });
  });

  test('should add and deactivate a department, hiding it from new requests', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/admin/org');
    await page.locator('#kind').selectOption('department');
    await page.locator('#name').fill('Logistics');
    await submit(page, 'Add');

    const [department] = await sql(
      `SELECT id, active FROM departments WHERE name = 'Logistics'`,
    );
    expect(department.active).toBe(true);

    await page.goto('/purchase-requests/new');
    await expect(
      page.locator('#departmentId option', { hasText: 'Logistics' }),
    ).toHaveCount(1);

    await page.goto('/admin/org');
    await page
      .locator(`form[action="/admin/org/department/${department.id}/toggle"]`)
      .getByRole('button')
      .click();
    await page.waitForLoadState('load');

    const [after] = await sql(`SELECT active FROM departments WHERE id = $1`, [
      department.id,
    ]);
    expect(after.active).toBe(false);

    await page.goto('/purchase-requests/new');
    await expect(
      page.locator('#departmentId option', { hasText: 'Logistics' }),
    ).toHaveCount(0);
  });

  test('should stop a manager approving above the limit an admin sets', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/admin/settings');
    // Seeded managers are unlimited; untick that to set a ceiling.
    await page.locator('input[name="unlimited_2"]').uncheck();
    await page.locator('#limit_2').fill('100'); // manager
    await submit(page, 'Save limits');

    const [limit] = await sql(
      `SELECT max_amount_usd FROM approval_thresholds WHERE role_id = 2`,
    );
    expect(limit.max_amount_usd).toBe('100.0000');

    await login(page, 'employee');
    await page.goto('/purchase-requests/new');
    await page.locator('#item-name-0').fill('Office chairs');
    await page.locator('#item-qty-0').fill('4');
    await page.locator('#item-price-0').fill('50');
    await submit(page, 'Submit for approval');
    const [pr] = await sql(
      `SELECT id FROM purchase_requests ORDER BY id DESC LIMIT 1`,
    );

    await login(page, 'manager');
    await page.goto(`/purchase-requests/${pr.id}`);
    await submit(page, 'Approve');

    await expect(page.getByText(/above your .* approval limit/)).toBeVisible();
    const [after] = await sql(
      `SELECT status FROM purchase_requests WHERE id = $1`,
      [pr.id],
    );
    expect(after.status).toBe('pending');
  });
});
