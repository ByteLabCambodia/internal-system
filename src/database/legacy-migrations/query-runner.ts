/**
 * The slice of TypeORM's migration API these files use. They predate the move to Prisma
 * and only ever call `queryRunner.query`, so they run without TypeORM (see ./index.ts).
 */
export interface QueryRunner {
  query(sql: string, params?: unknown[]): Promise<any>;
}

export interface MigrationInterface {
  name?: string;
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
}
