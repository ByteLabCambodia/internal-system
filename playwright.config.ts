import { defineConfig, devices } from '@playwright/test';
import { BROWSER_DB, BROWSER_PORT, serverEnv } from './test/browser/env';

/**
 * Browser tests against the real app: test/browser/reset-db.ts rebuilds a disposable
 * database (migrations + seeds), then the built app (dist/) is started against it.
 * Run `pnpm run build` first; `pnpm run test:browser` does both.
 */
export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.ts',
  // The flows build on each other's data and share one database.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${BROWSER_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm exec ts-node -T test/browser/reset-db.ts && node -r dotenv/config dist/main',
    url: `http://localhost:${BROWSER_PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: serverEnv(BROWSER_DB),
  },
});
