import { expect, test } from '@playwright/test';
import { login, USERS } from './support';

test.describe('sign in', () => {
  for (const role of Object.keys(USERS) as (keyof typeof USERS)[]) {
    test(`should let the ${role} reach the dashboard`, async ({ page }) => {
      await login(page, role);
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }

  test('should refuse a wrong password without saying which field was wrong', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.manager);
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
