import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from './support/test-db';
import { emptyDatabase, runMigrate } from './support/migrate-db';
import { schemaFingerprint } from './support/schema-fingerprint';
import { LEGACY_MIGRATIONS } from '../../src/database/legacy-migrations';
import { assertSigned } from '../../src/prisma/prisma.service';
import { Pool } from 'pg';

/**
 * The cutover from TypeORM migrations to Prisma's (src/database/migrate.ts). The shared
 * test database was built the fresh way, from the Prisma baseline, in globalSetup. Here a
 * second database is built the way production was, by the TypeORM-era migrations, and
 * upgraded; both must end up with the same schema.
 */
describe('database migrations', () => {
  const legacyUrl = (() => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `${url.pathname}_legacy`;
    return url.toString();
  })();

  async function withClient<T>(
    url: string,
    run: (client: Client) => Promise<T>,
  ) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }

  /** A database as TypeORM left it after the first `count` migrations. */
  async function typeormDatabase(count: number): Promise<void> {
    const admin = new URL(legacyUrl);
    const name = admin.pathname.slice(1);
    admin.pathname = '/postgres';
    await withClient(admin.toString(), async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${name}"`);
    });

    await withClient(legacyUrl, async (client) => {
      // TypeORM installed uuid-ossp itself and kept its history in `migrations`.
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE TABLE migrations (
          id serial PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL
        );
      `);
      const queryRunner = {
        query: async (sql: string, params?: unknown[]) =>
          (await client.query(sql, params)).rows,
      };
      for (const migration of LEGACY_MIGRATIONS.slice(0, count)) {
        await migration.up(queryRunner);
        const name = migration.name ?? migration.constructor.name;
        await client.query(
          `INSERT INTO migrations ("timestamp", name) VALUES ($1, $2)`,
          [Number(name.slice(-13)), name],
        );
      }
    });
  }

  afterAll(async () => {
    const admin = new URL(legacyUrl);
    const name = admin.pathname.slice(1);
    admin.pathname = '/postgres';
    await withClient(admin.toString(), (client) =>
      client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    );
  });

  it('should leave the fresh database signed and matching the contract', async () => {
    const { stdout } = await promisify(execFile)(
      'pnpm',
      ['exec', 'prisma', 'db', 'verify', '--db', TEST_DATABASE_URL, '--json'],
      { env: { ...process.env, PRISMA_DISABLE_TELEMETRY: '1' } },
    ).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }));

    const result = stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((line) => line.kind === 'result');

    expect(result?.envelope).toMatchObject({
      ok: true,
      result: { summary: 'Database marker and schema match contract' },
    });
  });

  it('should upgrade a TypeORM database (as production is) to the same schema', async () => {
    // Production at the cutover: the last two TypeORM migrations not yet run.
    await typeormDatabase(LEGACY_MIGRATIONS.length - 2);
    await withClient(legacyUrl, (client) =>
      client.query(
        `INSERT INTO "role" (id, name) VALUES (1, 'Admin');
         INSERT INTO suppliers (name) VALUES ('Kept across the upgrade');`,
      ),
    );

    const log = runMigrate(legacyUrl);
    expect(log).toContain(
      'Ran TypeORM-era migrations: MoveWorkflowTriggersToServices1785888700000, MoveUsdAndTimestampsToApp1785888800000',
    );
    expect(log).toContain('Signed the database at the Prisma baseline');

    expect(await schemaFingerprint(legacyUrl)).toEqual(
      await schemaFingerprint(TEST_DATABASE_URL),
    );
    expect(
      await withClient(
        legacyUrl,
        async (client) =>
          (await client.query(`SELECT name FROM suppliers`)).rows,
      ),
    ).toEqual([{ name: 'Kept across the upgrade' }]);

    // Every later deploy runs it again: nothing left to do, nothing re-run.
    const again = runMigrate(legacyUrl);
    expect(again).not.toContain('TypeORM-era');
    expect(again).toContain('Prisma migrations applied: 0');
  });

  it('should roll back the whole upgrade if a TypeORM-era migration fails', async () => {
    await typeormDatabase(LEGACY_MIGRATIONS.length - 2);
    // A row the last migration's new CHECK (exchange_rate > 0) rejects.
    await withClient(legacyUrl, (client) =>
      client.query(
        `ALTER TABLE payments DISABLE TRIGGER USER;
         INSERT INTO payments (amount_original, exchange_rate) VALUES (1, 0);`,
      ),
    );

    expect(() => runMigrate(legacyUrl)).toThrow();

    const state = await withClient(legacyUrl, async (client) => ({
      ran: (await client.query(`SELECT count(*)::int AS n FROM migrations`))
        .rows[0].n,
      signed: (
        await client.query(
          `SELECT to_regclass('prisma_contract.marker') IS NOT NULL AS signed`,
        )
      ).rows[0].signed,
    }));
    expect(state).toEqual({
      ran: LEGACY_MIGRATIONS.length - 2,
      signed: false,
    });
  });

  it('should build the journal balance check (T2) into a fresh database', async () => {
    await emptyDatabase(legacyUrl);
    runMigrate(legacyUrl);

    await withClient(legacyUrl, async (client) => {
      const {
        rows: [account],
      } = await client.query(
        `INSERT INTO accounts (code, name, type) VALUES ('1000', 'Cash', 'asset') RETURNING id`,
      );
      await client.query('BEGIN');
      const {
        rows: [entry],
      } = await client.query(
        `INSERT INTO journal_entries (source) VALUES ('manual') RETURNING id`,
      );
      await client.query(
        `INSERT INTO journal_lines (entry_id, account_id, debit_usd) VALUES ($1, $2, 5)`,
        [entry.id, account.id],
      );
      await expect(client.query('COMMIT')).rejects.toThrow(
        /journal entry \d+ does not balance/,
      );

      const { rows } = await client.query(
        `SELECT nextval('pr_number_seq') AS pr, nextval('po_number_seq') AS po`,
      );
      expect(rows).toEqual([{ pr: '1', po: '1' }]);
    });
  });

  it('should refuse to start the app on a database signed for another contract', async () => {
    await emptyDatabase(legacyUrl);
    runMigrate(legacyUrl);
    const pool = new Pool({ connectionString: legacyUrl });
    try {
      await expect(assertSigned(pool)).resolves.toBeUndefined();

      await pool.query(
        `UPDATE prisma_contract.marker SET core_hash = repeat('0', 64)`,
      );
      await expect(assertSigned(pool)).rejects.toThrow(
        /database is at contract 000000000000, this build expects/,
      );

      await pool.query(`DROP SCHEMA prisma_contract CASCADE`);
      await expect(assertSigned(pool)).rejects.toThrow(
        'The database is not signed with a Prisma contract.',
      );
    } finally {
      await pool.end();
    }

    const unreachable = new Pool({
      connectionString: 'postgres://nobody@127.0.0.1:1/none',
    });
    await expect(assertSigned(unreachable)).rejects.toThrow(/ECONNREFUSED/);
    await unreachable.end();
  });
});
