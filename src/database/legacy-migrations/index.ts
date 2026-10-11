import { ClientBase } from 'pg';
import { MigrationInterface } from './query-runner';
import { CreateUser1715028537217 } from './1715028537217-CreateUser';
import { OperationsUser1785888000000 } from './1785888000000-OperationsUser';
import { OperationsSchema1785888100000 } from './1785888100000-OperationsSchema';
import { OperationsTriggers1785888200000 } from './1785888200000-OperationsTriggers';
import { AllowPrSelfApproval1785888300000 } from './1785888300000-AllowPrSelfApproval';
import { ClarifyOverpaymentMessage1785888400000 } from './1785888400000-ClarifyOverpaymentMessage';
import { OmitZeroAlreadyPaid1785888500000 } from './1785888500000-OmitZeroAlreadyPaid';
import { RemoveManagerApprovalLimit1785888600000 } from './1785888600000-RemoveManagerApprovalLimit';
import { MoveWorkflowTriggersToServices1785888700000 } from './1785888700000-MoveWorkflowTriggersToServices';
import { MoveUsdAndTimestampsToApp1785888800000 } from './1785888800000-MoveUsdAndTimestampsToApp';

/**
 * The TypeORM-era migrations, oldest first. Frozen: schema changes are Prisma migrations
 * now (migrations/app/). These only bring a database that TypeORM built up to the Prisma
 * baseline, after which src/database/migrate.ts signs it and Prisma takes over.
 */
export const LEGACY_MIGRATIONS: MigrationInterface[] = [
  new CreateUser1715028537217(),
  new OperationsUser1785888000000(),
  new OperationsSchema1785888100000(),
  new OperationsTriggers1785888200000(),
  new AllowPrSelfApproval1785888300000(),
  new ClarifyOverpaymentMessage1785888400000(),
  new OmitZeroAlreadyPaid1785888500000(),
  new RemoveManagerApprovalLimit1785888600000(),
  new MoveWorkflowTriggersToServices1785888700000(),
  new MoveUsdAndTimestampsToApp1785888800000(),
];

const nameOf = (migration: MigrationInterface) =>
  migration.name ?? migration.constructor.name;

/** True when TypeORM's bookkeeping table exists, i.e. TypeORM built this database. */
export async function isLegacyDatabase(client: ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.migrations') IS NOT NULL AS exists`,
  );
  return rows[0].exists;
}

/**
 * Runs the legacy migrations this database has not run, in one transaction, recording
 * each in TypeORM's `migrations` table exactly as TypeORM did. Returns their names.
 */
export async function runLegacyMigrations(
  client: ClientBase,
): Promise<string[]> {
  const queryRunner = {
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  };

  await client.query('BEGIN');
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM public.migrations`,
    );
    const applied = new Set(rows.map((row) => row.name));
    const ran: string[] = [];

    for (const migration of LEGACY_MIGRATIONS) {
      const name = nameOf(migration);
      if (applied.has(name)) continue;

      await migration.up(queryRunner);
      await client.query(
        `INSERT INTO public.migrations ("timestamp", name) VALUES ($1, $2)`,
        [Number(name.match(/(\d{13})$/)![1]), name],
      );
      ran.push(name);
    }

    await client.query('COMMIT');
    return ran;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
