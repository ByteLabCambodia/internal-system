import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Runs src/database/migrate.ts against `url` in its own process, as the deploy does.
 * (Inside Jest, Prisma's migrator cannot load its migration packages.) Returns its log.
 */
export function runMigrate(url: string): string {
  return execFileSync(
    'npx',
    ['ts-node', '-r', 'tsconfig-paths/register', 'src/database/migrate.ts'],
    {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_ENABLED: 'false' },
      encoding: 'utf8',
    },
  );
}

/** Drops everything in the database, Prisma's marker included. */
export async function emptyDatabase(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS prisma_contract CASCADE;
      CREATE SCHEMA public;
    `);
  } finally {
    await client.end();
  }
}
