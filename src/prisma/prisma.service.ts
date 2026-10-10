import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json';
import { databaseUrl } from './database-url';
import { AllConfigType } from '../config/config.type';

function createDb(pool: Pool) {
  return postgres<Contract>({
    contractJson,
    pg: pool,
    // Prisma's own check only logs a warning; assertSigned() below refuses to start.
    verifyMarker: false,
  });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** What query helpers accept: the client, or the transaction they should join. */
export type Queryable = Pick<Db, 'orm'> | Tx;

/**
 * The Prisma ORM 8 client, on a pg pool sized and secured by the DATABASE_* settings.
 * At startup it checks that the database is signed with this contract (npm run migrate
 * signs it) and refuses to start otherwise, so code deployed ahead of its migrations
 * fails its health check instead of misreading the schema. PRISMA_VERIFY_MARKER=false
 * turns the check off.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Db;

  constructor(configService: ConfigService<AllConfigType>) {
    const database = configService.getOrThrow('database', { infer: true });

    this.pool = new Pool({
      connectionString: databaseUrl({
        DATABASE_URL: database.url,
        DATABASE_HOST: database.host,
        DATABASE_PORT: database.port ? String(database.port) : undefined,
        DATABASE_USERNAME: database.username,
        DATABASE_PASSWORD: database.password,
        DATABASE_NAME: database.name,
      }),
      max: database.maxConnections,
      connectionTimeoutMillis: 10_000,
      ssl: database.sslEnabled
        ? {
            rejectUnauthorized: database.rejectUnauthorized,
            ca: database.ca ?? undefined,
            key: database.key ?? undefined,
            cert: database.cert ?? undefined,
          }
        : undefined,
    });

    this.db = createDb(this.pool);
  }

  async onModuleInit(): Promise<void> {
    if (process.env.PRISMA_VERIFY_MARKER === 'false') return;
    await assertSigned(this.pool);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.close();
    await this.pool.end();
  }
}

/** Throws unless the database's marker names the contract this build was emitted from. */
export async function assertSigned(pool: Pool): Promise<void> {
  const expected = contractJson.storage.storageHash;
  const { rows } = await pool
    .query<{
      core_hash: string;
    }>(`SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'`)
    .catch((error: { code?: string }) => {
      // No marker table at all: never signed. Anything else (unreachable) is rethrown.
      if (error.code === '42P01')
        return { rows: [] as { core_hash: string }[] };
      throw error;
    });
  const actual = rows[0]?.core_hash;

  if (actual !== expected) {
    throw new Error(
      actual
        ? `The database is at contract ${actual.slice(0, 12)}, this build expects ${expected.slice(0, 12)}. Run \`npm run migrate\` first.`
        : `The database is not signed with a Prisma contract. Run \`npm run migrate\` first.`,
    );
  }
}
