import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { createPostgresControlClient } from '@prisma/orm-postgres/control';
import contractJson from '../prisma/contract.json';
import { databaseUrlWithSsl } from '../prisma/database-url';
import { isLegacyDatabase, runLegacyMigrations } from './legacy-migrations';

/**
 * Brings the database to the current contract: `npm run migrate` locally, and
 * `npm run migrate:prod` in the one-off ECS task the deploy runs before new tasks start.
 * Uses Prisma's control API rather than its CLI, which the production image does not
 * carry.
 *
 * 1. A database with a Prisma marker: apply the pending Prisma migrations.
 * 2. A database TypeORM built and nobody has signed yet (production at the cutover):
 *    run whichever of the frozen TypeORM-era migrations it lacks, sign it at the Prisma
 *    baseline (which those migrations produce), then continue as in 1.
 * 3. An empty database: the baseline migration creates everything.
 */
const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

type Result = { ok: boolean; failure?: unknown; value?: unknown };

function unwrap(step: string, result: Result) {
  if (!result.ok) {
    throw new Error(`${step} failed: ${JSON.stringify(result.failure)}`);
  }
  return result.value;
}

/** The contract the baseline migration (`from: null`) produces. */
function baselineContract(): unknown {
  const appDir = join(MIGRATIONS_DIR, 'app');
  for (const dir of readdirSync(appDir)) {
    if (dir === 'refs') continue;
    const manifest = JSON.parse(
      readFileSync(join(appDir, dir, 'migration.json'), 'utf8'),
    ) as { from: string | null; to: string };
    if (manifest.from === null) {
      return JSON.parse(
        readFileSync(
          join(MIGRATIONS_DIR, 'snapshots', manifest.to, 'contract.json'),
          'utf8',
        ),
      );
    }
  }
  throw new Error(`No baseline migration in ${appDir}`);
}

export async function migrate(
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
): Promise<void> {
  const url = databaseUrlWithSsl(env);
  const control = createPostgresControlClient({ connection: url });

  try {
    if (!(await control.readMarker())) {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        if (await isLegacyDatabase(client)) {
          const ran = await runLegacyMigrations(client);
          log(
            ran.length
              ? `Ran TypeORM-era migrations: ${ran.join(', ')}`
              : 'TypeORM-era migrations already up to date',
          );
          unwrap(
            'Signing the database at the Prisma baseline',
            (await control.dbSign({
              contract: baselineContract() as never,
              migrationsDir: MIGRATIONS_DIR,
            })) as Result,
          );
          log('Signed the database at the Prisma baseline');
        }
      } finally {
        await client.end();
      }
    }

    const result = unwrap(
      'Applying Prisma migrations',
      (await control.migrate({
        contract: contractJson,
        migrationsDir: MIGRATIONS_DIR,
      })) as Result,
    ) as { migrationsApplied?: number };
    log(`Prisma migrations applied: ${result?.migrationsApplied ?? 0}`);
  } finally {
    await control.close();
  }
}

if (require.main === module) {
  migrate().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
