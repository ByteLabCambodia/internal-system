import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

/**
 * A dedicated, disposable database. Never point this at a database you care about: every
 * spec file drops the schema and migrates it from scratch.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://${process.env.USER}@localhost:5432/internal_system_test`;

/**
 * Plain SQL for fixtures and assertions, on its own small pool so it never borrows the
 * app's Prisma connections. Rows come back exactly as `pg` parses them.
 */
@Injectable()
export class TestDb implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 4,
  });

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params)).rows as T[];
  }

  /** A dedicated connection, for holding a transaction open (see raceBehindLock). */
  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }
}
