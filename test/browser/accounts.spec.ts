import { expect, test } from '@playwright/test';
import { login, signIn, sql, submit } from './support';

/**
 * An account's life: an admin creates it with a starting password, the person is made
 * to choose their own on first sign-in, and an admin deactivates it.
 */
test.describe.configure({ mode: 'serial' });

const EMAIL = 'new.hire@example.com';

test.describe('accounts', () => {
  test('should let an admin create a user with a starting password', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/admin/users');
    await page.getByLabel('First name').fill('New');
    await page.getByLabel('Last name').fill('Hire');
    await page.locator('#email').fill(EMAIL);
    await page.locator('#roleId').selectOption('4'); // employee
    await page.locator('#department').fill('Warehouse');
    await page.locator('input[name="mode"][value="password"]').check();
    await page.locator('#password').fill('starting-pass-1');
    await submit(page, 'Create user');

    const [user] = await sql(
      `SELECT "firstName", "lastName", "roleId", department, must_change_password, active
         FROM "user" WHERE email = $1`,
      [EMAIL],
    );
    expect(user).toEqual({
      firstName: 'New',
      lastName: 'Hire',
      roleId: 4,
      department: 'Warehouse',
      must_change_password: true,
      active: true,
    });
  });

  test('should make the new user choose a password, keeping their details', async ({
    page,
  }) => {
    await signIn(page, EMAIL, 'starting-pass-1');
    await expect(page).toHaveURL(/\/set-password/);

    await page
      .getByLabel('Password', { exact: false })
      .first()
      .fill('my-own-pass-1');
    await page.getByLabel('Confirm password').fill('my-own-pass-1');
    await submit(page, 'Save password');

    // Setting a password used to erase department and payment details.
    const [user] = await sql(
      `SELECT "firstName", department, must_change_password FROM "user" WHERE email = $1`,
      [EMAIL],
    );
    expect(user).toEqual({
      firstName: 'New',
      department: 'Warehouse',
      must_change_password: false,
    });

    await signIn(page, EMAIL, 'starting-pass-1');
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, EMAIL, 'my-own-pass-1');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should sign a deactivated user out and keep them out', async ({
    page,
    browser,
  }) => {
    const theirs = await browser.newPage();
    await signIn(theirs, EMAIL, 'my-own-pass-1');
    await expect(theirs).toHaveURL(/\/dashboard/);

    await login(page, 'admin');
    const [user] = await sql(`SELECT id FROM "user" WHERE email = $1`, [EMAIL]);
    await page.goto(`/admin/users/${user.id}/edit`);
    await page.locator('#active').selectOption('false');
    await submit(page, 'Save changes');

    const [after] = await sql(
      `SELECT active, department FROM "user" WHERE id = $1`,
      [user.id],
    );
    expect(after).toEqual({ active: false, department: 'Warehouse' });

    const live = await sql(
      `SELECT 1 FROM session WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      [user.id],
    );
    expect(live).toHaveLength(0);

    await theirs.goto('/dashboard');
    await expect(theirs).toHaveURL(/\/login/);
    await signIn(theirs, EMAIL, 'my-own-pass-1');
    await expect(theirs).toHaveURL(/\/login/);
    await theirs.close();
  });

  test('should not let an admin delete their own account', async ({ page }) => {
    await login(page, 'admin');
    const [admin] = await sql(
      `SELECT id FROM "user" WHERE email = 'admin@example.com'`,
    );
    await page.goto('/admin/users');
    await page
      .locator(`form[action="/admin/users/${admin.id}/delete"]`)
      .getByRole('button')
      .click();
    await page.waitForLoadState('load');

    await expect(
      page.getByText('You cannot delete your own account.'),
    ).toBeVisible();
    const [still] = await sql(`SELECT "deletedAt" FROM "user" WHERE id = $1`, [
      admin.id,
    ]);
    expect(still.deletedAt).toBeNull();
  });
});
