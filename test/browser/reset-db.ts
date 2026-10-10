import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { BROWSER_DB, serverEnv } from './env';

/**
 * Drop and recreate the browser-test database, then migrate and seed it. Run as part of
 * the webServer command (Playwright starts the web server before globalSetup).
 */
async function resetDatabase(): Promise<void> {
  const target = new URL(BROWSER_DB);
  const name = target.pathname.slice(1);
  const admin = new URL(BROWSER_DB);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
  await client.end();

  const env = { ...process.env, ...serverEnv(BROWSER_DB) };
  const run = (args: string[]) =>
    execFileSync('npx', ['ts-node', '-r', 'tsconfig-paths/register', ...args], {
      env,
      stdio: 'pipe',
    });

  run(['./src/database/migrate.ts']);
  run(['./src/database/seeds/seed.ts']);
}

resetDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
