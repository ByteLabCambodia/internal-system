import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json';
import { databaseUrl } from './database-url';
import { AllConfigType } from '../config/config.type';

function createDb(pool: Pool, verifyMarker: boolean) {
  return postgres<Contract>({
    contractJson,
    pg: pool,
    verifyMarker: verifyMarker ? 'onFirstUse' : false,
  });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** What query helpers accept: the client, or the transaction they should join. */
export type Queryable = Pick<Db, 'orm'> | Tx;

/**
 * The Prisma ORM 8 client. Shares the pool settings TypeORM uses (size, timeout, SSL),
 * and on first use checks that the database is signed with this contract, so a deploy
 * whose migrations have not run fails loudly instead of querying a mismatched schema.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
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

    this.db = createDb(this.pool, process.env.PRISMA_VERIFY_MARKER !== 'false');
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.close();
    await this.pool.end();
  }
}
