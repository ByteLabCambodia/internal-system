import { MigrationInterface, QueryRunner } from 'typeorm';

const UPDATED_AT_TABLES = [
  'app_settings',
  'departments',
  'projects',
  'suppliers',
  'accounts',
  'journal_entries',
  'exchange_rates',
  'budgets',
  'categories',
  'inventory_items',
  'inventory_claims',
  'stock_requests',
  'purchase_requests',
  'purchase_orders',
  'payments',
];

const RATE_TABLES = ['payments', 'purchase_requests', 'purchase_orders'];

/**
 * The last non-ledger logic leaves the database:
 *   T1 derive_amount_usd / derive_total_usd -> MoneyService.toUsd in the services; a
 *      plain CHECK (exchange_rate > 0) keeps the one rule worth enforcing here.
 *   set_updated_at                          -> TypeORM @UpdateDateColumn, which every
 *      one of these tables' entities already has.
 *
 * Only T2 (journal_lines_balanced) remains.
 */
export class MoveUsdAndTimestampsToApp1785888800000 implements MigrationInterface {
  name = 'MoveUsdAndTimestampsToApp1785888800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "payments_derive_amount_usd" ON "payments"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "purchase_requests_derive_total_usd" ON "purchase_requests"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "purchase_orders_derive_total_usd" ON "purchase_orders"`,
    );
    await queryRunner.query(`DROP FUNCTION derive_amount_usd()`);
    await queryRunner.query(`DROP FUNCTION derive_total_usd()`);

    for (const table of RATE_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_exchange_rate_positive" CHECK ("exchange_rate" > 0)`,
      );
    }

    for (const table of UPDATED_AT_TABLES) {
      await queryRunner.query(
        `DROP TRIGGER "${table}_set_updated_at" ON "${table}"`,
      );
    }
    await queryRunner.query(`DROP FUNCTION set_updated_at()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of RATE_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "${table}_exchange_rate_positive"`,
      );
    }

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    for (const table of UPDATED_AT_TABLES) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_set_updated_at"
        BEFORE UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      `);
    }

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION derive_amount_usd() RETURNS trigger AS $$
      BEGIN
        IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
          RAISE EXCEPTION 'exchange_rate must be greater than 0 (got %)', NEW.exchange_rate;
        END IF;
        NEW.amount_usd := round(NEW.amount_original / NEW.exchange_rate, 4);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION derive_total_usd() RETURNS trigger AS $$
      BEGIN
        IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
          RAISE EXCEPTION 'exchange_rate must be greater than 0 (got %)', NEW.exchange_rate;
        END IF;
        NEW.total_usd := round(NEW.total_original / NEW.exchange_rate, 4);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "payments_derive_amount_usd"
      BEFORE INSERT OR UPDATE OF amount_original, exchange_rate ON "payments"
      FOR EACH ROW EXECUTE FUNCTION derive_amount_usd();
    `);
    await queryRunner.query(`
      CREATE TRIGGER "purchase_requests_derive_total_usd"
      BEFORE INSERT OR UPDATE OF total_original, exchange_rate ON "purchase_requests"
      FOR EACH ROW EXECUTE FUNCTION derive_total_usd();
    `);
    await queryRunner.query(`
      CREATE TRIGGER "purchase_orders_derive_total_usd"
      BEFORE INSERT OR UPDATE OF total_original, exchange_rate ON "purchase_orders"
      FOR EACH ROW EXECUTE FUNCTION derive_total_usd();
    `);
  }
}
