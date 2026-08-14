import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The complete operations schema from Part 2 of NESTJS_MIGRATION_BRIEF.md, with the C1–C4
 * corrections applied. Deviations from the brief's DDL, both recorded in AGENTS.md:
 *   - primary keys are integer identity columns, not uuid;
 *   - `references users (id)` becomes `references "user" (id)` (the boilerplate's table).
 *
 * Money is numeric(18,4). `exchange_rate` is numeric(18,6) and means units per 1 USD.
 * The T1–T6 invariants live in the next migration.
 */
export class OperationsSchema1785888100000 implements MigrationInterface {
  name = 'OperationsSchema1785888100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- enums ----------------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."currency" AS ENUM('USD', 'KHR', 'CNY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pr_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'cancelled', 'converted')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."po_type" AS ENUM('online', 'physical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."po_status" AS ENUM('open', 'partial', 'complete', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partial', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."claim_status" AS ENUM('pending', 'confirmed', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."stock_request_status" AS ENUM('pending', 'approved', 'fulfilled', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."stock_priority" AS ENUM('low', 'medium', 'high', 'urgent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."movement_reason" AS ENUM('claim', 'stock_request', 'adjustment')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."journal_source" AS ENUM('po_payment', 'manual_income', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_source" AS ENUM('api', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cash', 'card', 'mobile', 'other')`,
    );

    // --- settings the triggers themselves read --------------------------------------
    await queryRunner.query(`
      CREATE TABLE "app_settings" (
        "key" text NOT NULL,
        "value" text NOT NULL,
        "description" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_settings" PRIMARY KEY ("key")
      )
    `);

    // --- org --------------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "departments" (
        "id" SERIAL NOT NULL,
        "name" text NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_departments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" SERIAL NOT NULL,
        "name" text NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id")
      )
    `);
    // C4
    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" SERIAL NOT NULL,
        "name" text NOT NULL,
        "contact_name" text,
        "phone" text,
        "email" text,
        "address" text,
        "bank_account" text,
        "payment_terms_days" integer,
        "note" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "suppliers_name_key" UNIQUE ("name"),
        CONSTRAINT "PK_suppliers" PRIMARY KEY ("id")
      )
    `);
    // C2 — one tier per role; null max_amount_usd means unlimited
    await queryRunner.query(`
      CREATE TABLE "approval_thresholds" (
        "id" SERIAL NOT NULL,
        "role_id" integer NOT NULL,
        "max_amount_usd" numeric(18,4),
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "approval_thresholds_role_key" UNIQUE ("role_id"),
        CONSTRAINT "PK_approval_thresholds" PRIMARY KEY ("id"),
        CONSTRAINT "FK_approval_thresholds_role" FOREIGN KEY ("role_id") REFERENCES "role" ("id")
      )
    `);

    // --- accounting -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" SERIAL NOT NULL,
        "code" text NOT NULL,
        "name" text NOT NULL,
        "type" "public"."account_type" NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "accounts_code_key" UNIQUE ("code"),
        CONSTRAINT "PK_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "journal_entries" (
        "id" SERIAL NOT NULL,
        "entry_date" date NOT NULL DEFAULT current_date,
        "memo" text,
        "currency" "public"."currency" NOT NULL DEFAULT 'USD',
        "exchange_rate" numeric(18,6) NOT NULL DEFAULT 1,
        "source" "public"."journal_source" NOT NULL,
        "source_ref" integer,
        "created_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_journal_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_journal_entries_created_by" FOREIGN KEY ("created_by") REFERENCES "user" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "journal_lines" (
        "id" SERIAL NOT NULL,
        "entry_id" integer NOT NULL,
        "account_id" integer NOT NULL,
        "debit_usd" numeric(18,4) NOT NULL DEFAULT 0,
        "credit_usd" numeric(18,4) NOT NULL DEFAULT 0,
        "dimension_department_id" integer,
        "dimension_project_id" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "journal_line_one_sided" CHECK (
          "debit_usd" >= 0 AND "credit_usd" >= 0
          AND NOT ("debit_usd" > 0 AND "credit_usd" > 0)),
        CONSTRAINT "PK_journal_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_journal_lines_entry" FOREIGN KEY ("entry_id")
          REFERENCES "journal_entries" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_journal_lines_account" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id"),
        CONSTRAINT "FK_journal_lines_department" FOREIGN KEY ("dimension_department_id") REFERENCES "departments" ("id"),
        CONSTRAINT "FK_journal_lines_project" FOREIGN KEY ("dimension_project_id") REFERENCES "projects" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" ("entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "journal_lines_account_idx" ON "journal_lines" ("account_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "exchange_rates" (
        "id" SERIAL NOT NULL,
        "rate_date" date NOT NULL,
        "currency" "public"."currency" NOT NULL,
        "rate_to_usd" numeric(18,6) NOT NULL,
        "source" "public"."rate_source" NOT NULL DEFAULT 'manual',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "exchange_rates_date_currency_key" UNIQUE ("rate_date", "currency"),
        CONSTRAINT "PK_exchange_rates" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "budgets" (
        "id" SERIAL NOT NULL,
        "department_id" integer,
        "project_id" integer,
        "category" text,
        "period" date NOT NULL,
        "amount_usd" numeric(18,4) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_budgets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_budgets_department" FOREIGN KEY ("department_id") REFERENCES "departments" ("id"),
        CONSTRAINT "FK_budgets_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "event" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "telegram_sent" boolean NOT NULL DEFAULT false,
        "read" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id")
          REFERENCES "user" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "read")`,
    );

    // --- inventory --------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" SERIAL NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "expense_account_id" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "categories_name_key" UNIQUE ("name"),
        CONSTRAINT "PK_categories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_categories_expense_account" FOREIGN KEY ("expense_account_id") REFERENCES "accounts" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "inventory_items" (
        "id" SERIAL NOT NULL,
        "sku" text NOT NULL,
        "name" text NOT NULL,
        "category" text,
        "unit" text NOT NULL DEFAULT 'pcs',
        "stock_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "reorder_point" numeric(18,4) NOT NULL DEFAULT 0,
        "reorder_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "inventory_items_sku_key" UNIQUE ("sku"),
        CONSTRAINT "PK_inventory_items" PRIMARY KEY ("id")
      )
    `);

    // --- procurement ------------------------------------------------------------------
    // IF NOT EXISTS because `schema:drop` drops tables and types but leaves standalone
    // sequences behind, which would break the db:reset the brief asks us to verify with.
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "pr_number_seq" START 1`,
    );
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "po_number_seq" START 1`,
    );
    await queryRunner.query(`
      CREATE TABLE "purchase_requests" (
        "id" SERIAL NOT NULL,
        "pr_number" text NOT NULL DEFAULT ('PR-' || lpad(nextval('pr_number_seq')::text, 4, '0')),
        "requester_id" integer NOT NULL,
        "status" "public"."pr_status" NOT NULL DEFAULT 'draft',
        "currency" "public"."currency" NOT NULL DEFAULT 'USD',
        "exchange_rate" numeric(18,6) NOT NULL DEFAULT 1,
        "total_original" numeric(18,4) NOT NULL DEFAULT 0,
        "total_usd" numeric(18,4) NOT NULL DEFAULT 0,
        "department_id" integer,
        "project_id" integer,
        "note" text,
        "approver_id" integer,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "telegram_message_id" bigint,
        "telegram_chat_id" bigint,
        "auto_generated" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_requests_requester" FOREIGN KEY ("requester_id") REFERENCES "user" ("id"),
        CONSTRAINT "FK_purchase_requests_approver" FOREIGN KEY ("approver_id") REFERENCES "user" ("id"),
        CONSTRAINT "FK_purchase_requests_department" FOREIGN KEY ("department_id") REFERENCES "departments" ("id"),
        CONSTRAINT "FK_purchase_requests_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "purchase_requests_requester_idx" ON "purchase_requests" ("requester_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests" ("status")`,
    );
    await queryRunner.query(`
      CREATE TABLE "purchase_request_items" (
        "id" SERIAL NOT NULL,
        "pr_id" integer NOT NULL,
        "name" text NOT NULL,
        "qty" numeric(18,4) NOT NULL DEFAULT 1,
        "unit_price_original" numeric(18,4) NOT NULL DEFAULT 0,
        "inventory_item_id" integer,
        "category" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_request_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_request_items_pr" FOREIGN KEY ("pr_id")
          REFERENCES "purchase_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_request_items_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "purchase_request_items_pr_idx" ON "purchase_request_items" ("pr_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "purchase_orders" (
        "id" SERIAL NOT NULL,
        "po_number" text NOT NULL DEFAULT ('PO-' || lpad(nextval('po_number_seq')::text, 4, '0')),
        "pr_id" integer,
        "type" "public"."po_type" NOT NULL DEFAULT 'online',
        "supplier" text,
        "supplier_id" integer,
        "expense_account_id" integer,
        "currency" "public"."currency" NOT NULL DEFAULT 'USD',
        "exchange_rate" numeric(18,6) NOT NULL DEFAULT 1,
        "status" "public"."po_status" NOT NULL DEFAULT 'open',
        "payment_status" "public"."payment_status" NOT NULL DEFAULT 'unpaid',
        "total_original" numeric(18,4) NOT NULL DEFAULT 0,
        "total_usd" numeric(18,4) NOT NULL DEFAULT 0,
        "department_id" integer,
        "project_id" integer,
        "created_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_orders_pr" FOREIGN KEY ("pr_id") REFERENCES "purchase_requests" ("id"),
        CONSTRAINT "FK_purchase_orders_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id"),
        CONSTRAINT "FK_purchase_orders_expense_account" FOREIGN KEY ("expense_account_id") REFERENCES "accounts" ("id"),
        CONSTRAINT "FK_purchase_orders_department" FOREIGN KEY ("department_id") REFERENCES "departments" ("id"),
        CONSTRAINT "FK_purchase_orders_project" FOREIGN KEY ("project_id") REFERENCES "projects" ("id"),
        CONSTRAINT "FK_purchase_orders_created_by" FOREIGN KEY ("created_by") REFERENCES "user" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" ("status")`,
    );
    await queryRunner.query(`
      CREATE TABLE "purchase_order_items" (
        "id" SERIAL NOT NULL,
        "po_id" integer NOT NULL,
        "inventory_item_id" integer,
        "name" text NOT NULL,
        "qty_ordered" numeric(18,4) NOT NULL DEFAULT 1,
        "qty_claimed" numeric(18,4) NOT NULL DEFAULT 0,
        "unit_price_original" numeric(18,4) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_order_items_po" FOREIGN KEY ("po_id")
          REFERENCES "purchase_orders" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_order_items_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "purchase_order_items_po_idx" ON "purchase_order_items" ("po_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" SERIAL NOT NULL,
        "po_id" integer,
        "amount_original" numeric(18,4) NOT NULL,
        "currency" "public"."currency" NOT NULL DEFAULT 'USD',
        "exchange_rate" numeric(18,6) NOT NULL DEFAULT 1,
        "amount_usd" numeric(18,4) NOT NULL DEFAULT 0,
        "expense_account_id" integer,
        "method" "public"."payment_method",
        "bank_account" text,
        "reference" text,
        "trx_id" text,
        "sender" text,
        "transfer_to" text,
        "remark" text,
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "receipt_object_key" text,
        "recorded_by" integer,
        "journal_entry_id" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_po" FOREIGN KEY ("po_id") REFERENCES "purchase_orders" ("id"),
        CONSTRAINT "FK_payments_expense_account" FOREIGN KEY ("expense_account_id") REFERENCES "accounts" ("id"),
        CONSTRAINT "FK_payments_recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "user" ("id"),
        CONSTRAINT "FK_payments_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "payments_po_idx" ON "payments" ("po_id")`,
    );

    // --- claims, stock requests, movements ---------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "inventory_claims" (
        "id" SERIAL NOT NULL,
        "po_id" integer,
        "po_item_id" integer,
        "inventory_item_id" integer NOT NULL,
        "qty_claimed" numeric(18,4) NOT NULL,
        "status" "public"."claim_status" NOT NULL DEFAULT 'pending',
        "receipt_object_key" text,
        "claimed_by" integer,
        "confirmed_by" integer,
        "confirmed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "inventory_claims_qty_check" CHECK ("qty_claimed" > 0),
        CONSTRAINT "PK_inventory_claims" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_claims_po" FOREIGN KEY ("po_id") REFERENCES "purchase_orders" ("id"),
        CONSTRAINT "FK_inventory_claims_po_item" FOREIGN KEY ("po_item_id") REFERENCES "purchase_order_items" ("id"),
        CONSTRAINT "FK_inventory_claims_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id"),
        CONSTRAINT "FK_inventory_claims_claimed_by" FOREIGN KEY ("claimed_by") REFERENCES "user" ("id"),
        CONSTRAINT "FK_inventory_claims_confirmed_by" FOREIGN KEY ("confirmed_by") REFERENCES "user" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "inventory_claims_po_idx" ON "inventory_claims" ("po_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "stock_requests" (
        "id" SERIAL NOT NULL,
        "requester_id" integer NOT NULL,
        "inventory_item_id" integer NOT NULL,
        "qty" numeric(18,4) NOT NULL,
        "status" "public"."stock_request_status" NOT NULL DEFAULT 'pending',
        "priority" "public"."stock_priority" NOT NULL DEFAULT 'medium',
        "department" text,
        "approved_by" integer,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "fulfilled_by" integer,
        "fulfilled_at" TIMESTAMP WITH TIME ZONE,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "stock_requests_qty_check" CHECK ("qty" > 0),
        CONSTRAINT "PK_stock_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_requests_requester" FOREIGN KEY ("requester_id") REFERENCES "user" ("id"),
        CONSTRAINT "FK_stock_requests_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id"),
        CONSTRAINT "FK_stock_requests_approved_by" FOREIGN KEY ("approved_by") REFERENCES "user" ("id"),
        CONSTRAINT "FK_stock_requests_fulfilled_by" FOREIGN KEY ("fulfilled_by") REFERENCES "user" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "stock_requests_requester_idx" ON "stock_requests" ("requester_id")`,
    );
    // append-only ledger; written ONLY by triggers and the adjustStock service method
    await queryRunner.query(`
      CREATE TABLE "stock_movements" (
        "id" SERIAL NOT NULL,
        "inventory_item_id" integer NOT NULL,
        "delta" numeric(18,4) NOT NULL,
        "reason" "public"."movement_reason" NOT NULL,
        "ref_table" text,
        "ref_id" integer,
        "balance_after" numeric(18,4) NOT NULL,
        "created_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_movements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_movements_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id"),
        CONSTRAINT "FK_stock_movements_created_by" FOREIGN KEY ("created_by") REFERENCES "user" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "stock_movements_item_idx" ON "stock_movements" ("inventory_item_id", "created_at")`,
    );

    // --- audit & integration ------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "activity_events" (
        "id" SERIAL NOT NULL,
        "entity_type" text NOT NULL,
        "entity_id" integer NOT NULL,
        "action" text NOT NULL,
        "actor_id" integer,
        "detail" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_activity_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_activity_events_actor" FOREIGN KEY ("actor_id") REFERENCES "user" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "activity_events_entity_idx" ON "activity_events" ("entity_type", "entity_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "activity_events_actor_idx" ON "activity_events" ("actor_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "telegram_updates" (
        "update_id" bigint NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_telegram_updates" PRIMARY KEY ("update_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'telegram_updates',
      'activity_events',
      'stock_movements',
      'stock_requests',
      'inventory_claims',
      'payments',
      'purchase_order_items',
      'purchase_orders',
      'purchase_request_items',
      'purchase_requests',
      'inventory_items',
      'categories',
      'notifications',
      'budgets',
      'exchange_rates',
      'journal_lines',
      'journal_entries',
      'accounts',
      'approval_thresholds',
      'suppliers',
      'projects',
      'departments',
      'app_settings',
    ]) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }

    await queryRunner.query(`DROP SEQUENCE "po_number_seq"`);
    await queryRunner.query(`DROP SEQUENCE "pr_number_seq"`);

    for (const type of [
      'payment_method',
      'rate_source',
      'journal_source',
      'movement_reason',
      'account_type',
      'stock_priority',
      'stock_request_status',
      'claim_status',
      'payment_status',
      'po_status',
      'po_type',
      'pr_status',
      'currency',
    ]) {
      await queryRunner.query(`DROP TYPE "public"."${type}"`);
    }
  }
}
