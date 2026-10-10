import { expect, Page } from '@playwright/test';
import { Client } from 'pg';
import { BROWSER_DB } from './env';

/** Seeded by src/database/seeds/relational/user: one account per role. */
export const USERS = {
  admin: 'admin@example.com',
  manager: 'manager@example.com',
  finance: 'finance@example.com',
  employee: 'employee@example.com',
} as const;

export async function login(page: Page, role: keyof typeof USERS) {
  await signIn(page, USERS[role], 'secret');
  await expect(page).not.toHaveURL(/\/login/);
}

/** Submit the sign-in form; the caller asserts where it lands. */
export async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
  await page.waitForLoadState('load');
}

/** The flash message the app shows after a form post. */
export function toast(page: Page) {
  return page.getByRole('alert');
}

/** Direct reads for assertions the UI does not show (journal lines, ledger rows). */
export async function sql<T = Record<string, any>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: BROWSER_DB });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Click a form's submit button and wait until the app has answered the POST. */
export async function submit(page: Page, button: string) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.getByRole('button', { name: button }).first().click(),
  ]);
  await page.waitForLoadState('load');
}
