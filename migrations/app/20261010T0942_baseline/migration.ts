#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/569cd35f4c53b282ab5083d855b2617be5776e9553e22a11c83024c89406e903/contract';
import endContract from '../../snapshots/569cd35f4c53b282ab5083d855b2617be5776e9553e22a11c83024c89406e903/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  rawSql,
} from '@prisma/orm-postgres/migration';

/**
 * What the contract does not describe but the database needs, added by hand to the
 * planned baseline: the PR/PO number sequences the column defaults call, and trigger
 * T2, which refuses to commit a journal entry whose lines do not balance.
 */
const sequence = (name: string) =>
  rawSql({
    id: `sequence.${name}`,
    label: `Create sequence "${name}"`,
    operationClass: 'additive',
    target: {
      id: 'postgres',
      details: { schema: 'public', objectType: 'sequence', name },
    },
    precheck: [],
    execute: [
      {
        description: `create sequence "${name}"`,
        sql: `CREATE SEQUENCE IF NOT EXISTS "public"."${name}"`,
        params: [],
      },
    ],
    postcheck: [],
  });

/** The app stamps updated_at itself, but raw inserts (seeds, fixtures) rely on this. */
const UPDATED_AT_TABLES = [
  'accounts',
  'app_settings',
  'departments',
  'projects',
  'budgets',
  'categories',
  'exchange_rates',
  'inventory_items',
  'purchase_requests',
  'suppliers',
  'purchase_orders',
  'inventory_claims',
  'journal_entries',
  'payments',
  'stock_requests',
];

const updatedAtDefaults = rawSql({
  id: 'default.updated_at',
  label: 'Default updated_at to now()',
  operationClass: 'additive',
  target: {
    id: 'postgres',
    details: { schema: 'public', objectType: 'table', name: 'updated_at' },
  },
  precheck: [],
  execute: UPDATED_AT_TABLES.map((table) => ({
    description: `default "${table}".updated_at to now()`,
    sql: `ALTER TABLE "public"."${table}" ALTER COLUMN "updated_at" SET DEFAULT now()`,
    params: [],
  })),
  postcheck: [],
});

const journalBalanceTrigger = rawSql({
  id: 'trigger.journal_lines_balanced',
  label: 'Create trigger "journal_lines_balanced" (T2)',
  operationClass: 'additive',
  target: {
    id: 'postgres',
    details: {
      schema: 'public',
      objectType: 'trigger',
      name: 'journal_lines_balanced',
    },
  },
  precheck: [],
  execute: [
    {
      description: 'create function "assert_journal_entry_balanced"',
      sql: `CREATE OR REPLACE FUNCTION public.assert_journal_entry_balanced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE
        v_entry_id integer;
        v_debit numeric(18,4);
        v_credit numeric(18,4);
      BEGIN
        v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
        -- the parent entry may have been deleted along with its lines
        IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = v_entry_id) THEN
          RETURN NULL;
        END IF;
        SELECT COALESCE(sum(debit_usd), 0), COALESCE(sum(credit_usd), 0)
          INTO v_debit, v_credit
          FROM journal_lines WHERE entry_id = v_entry_id;
        IF round(v_debit, 4) <> round(v_credit, 4) THEN
          RAISE EXCEPTION
            'journal entry % does not balance: debit % <> credit %',
            v_entry_id, v_debit, v_credit;
        END IF;
        RETURN NULL;
      END;
      $$`,
      params: [],
    },
    {
      description: 'create constraint trigger "journal_lines_balanced"',
      sql: `CREATE CONSTRAINT TRIGGER journal_lines_balanced
    AFTER INSERT OR DELETE OR UPDATE ON public.journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.assert_journal_entry_balanced()`,
      params: [],
    },
  ],
  postcheck: [],
});

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      sequence('pr_number_seq'),
      sequence('po_number_seq'),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'account_type',
        members: ['asset', 'liability', 'equity', 'income', 'expense'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'claim_status',
        members: ['pending', 'confirmed', 'rejected'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'currency',
        members: ['USD', 'KHR', 'CNY'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'journal_source',
        members: ['po_payment', 'manual_income', 'manual'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'movement_reason',
        members: ['claim', 'stock_request', 'adjustment'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'payment_method',
        members: ['bank_transfer', 'cash', 'card', 'mobile', 'other'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'payment_status',
        members: ['unpaid', 'partial', 'paid'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'po_status',
        members: ['open', 'partial', 'complete', 'cancelled'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'po_type',
        members: ['online', 'physical'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'pr_status',
        members: ['draft', 'pending', 'approved', 'rejected', 'cancelled', 'converted'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'rate_source',
        members: ['api', 'manual'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'stock_priority',
        members: ['low', 'medium', 'high', 'urgent'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'stock_request_status',
        members: ['pending', 'approved', 'fulfilled', 'rejected'],
      }),
      this.createTable({
        schema: 'public',
        table: 'accounts',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', '"account_type"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'account_type' } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_accounts' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'activity_events',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('actor_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('detail', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('entity_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('entity_type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_activity_events' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'app_settings',
        columns: [
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['key'], { name: 'PK_app_settings' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_thresholds',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('max_amount_usd', 'numeric(18,4)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('role_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_approval_thresholds' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'auth_tokens',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expires_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('purpose', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('token_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('used_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('user_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_auth_tokens' }),
          checkExpression(
            'auth_tokens_purpose_check',
            "(purpose = ANY (ARRAY['invite'::text, 'reset'::text]))",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'budgets',
        columns: [
          col('amount_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('department_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('period', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('project_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_budgets' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'categories',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expense_account_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_categories' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'departments',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_departments' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'exchange_rates',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', '"currency"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'currency' } },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('rate_date', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('rate_to_usd', 'numeric(18,6)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 6 } },
          }),
          col('source', '"rate_source"', {
            notNull: true,
            default: lit('manual'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'rate_source' } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_exchange_rates' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'file',
        columns: [
          col('id', 'uuid', {
            notNull: true,
            default: fn('gen_random_uuid()'),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('path', 'character varying', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_36b46d232307066b3a2c9ea3a1d' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'inventory_claims',
        columns: [
          col('claimed_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('confirmed_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('confirmed_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('inventory_item_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('po_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('po_item_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('qty_claimed', 'numeric(18,4)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('receipt_object_key', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"claim_status"', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'claim_status' } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_inventory_claims' }),
          checkExpression('inventory_claims_qty_check', '(qty_claimed > (0)::numeric)'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'inventory_items',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reorder_point', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('reorder_qty', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('sku', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stock_qty', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('unit', 'text', {
            notNull: true,
            default: lit('pcs'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_inventory_items' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'journal_entries',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('currency', '"currency"', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'currency' } },
          }),
          col('entry_date', 'date', {
            notNull: true,
            default: fn('CURRENT_DATE'),
            codecRef: { codecId: 'pg/date-string@1' },
          }),
          col('exchange_rate', 'numeric(18,6)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 6 } },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('memo', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', '"journal_source"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'journal_source' } },
          }),
          col('source_ref', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_journal_entries' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'journal_lines',
        columns: [
          col('account_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('credit_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('debit_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('dimension_department_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('dimension_project_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('entry_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_journal_lines' }),
          checkExpression(
            'journal_line_one_sided',
            '((debit_usd >= (0)::numeric) AND (credit_usd >= (0)::numeric) AND (NOT ((debit_usd > (0)::numeric) AND (credit_usd > (0)::numeric))))',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'notifications',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('event', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('payload', 'jsonb', {
            notNull: true,
            default: lit({}),
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('read', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('telegram_sent', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('user_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_notifications' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'payments',
        columns: [
          col('amount_original', 'numeric(18,4)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('amount_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('bank_account', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', '"currency"', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'currency' } },
          }),
          col('exchange_rate', 'numeric(18,6)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 6 } },
          }),
          col('expense_account_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('journal_entry_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('method', '"payment_method"', {
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'payment_method' } },
          }),
          col('paid_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('po_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('receipt_object_key', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('recorded_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('reference', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('remark', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sender', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transfer_to', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('trx_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_payments' }),
          checkExpression('payments_exchange_rate_positive', '(exchange_rate > (0)::numeric)'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'projects',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_projects' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'purchase_order_items',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('inventory_item_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('po_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('qty_claimed', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('qty_ordered', 'numeric(18,4)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('unit_price_original', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_purchase_order_items' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'purchase_orders',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('currency', '"currency"', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'currency' } },
          }),
          col('department_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('exchange_rate', 'numeric(18,6)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 6 } },
          }),
          col('expense_account_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('payment_status', '"payment_status"', {
            notNull: true,
            default: lit('unpaid'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'payment_status' } },
          }),
          col('po_number', 'text', {
            notNull: true,
            default: fn(
              "('PO-'::text || lpad((nextval('po_number_seq'::regclass))::text, 4, '0'::text))",
            ),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('pr_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('project_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('status', '"po_status"', {
            notNull: true,
            default: lit('open'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'po_status' } },
          }),
          col('supplier', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('supplier_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('total_original', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('total_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('type', '"po_type"', {
            notNull: true,
            default: lit('online'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'po_type' } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_purchase_orders' }),
          checkExpression(
            'purchase_orders_exchange_rate_positive',
            '(exchange_rate > (0)::numeric)',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'purchase_request_items',
        columns: [
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('inventory_item_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pr_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('qty', 'numeric(18,4)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('unit_price_original', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_purchase_request_items' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'purchase_requests',
        columns: [
          col('approver_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('auto_generated', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', '"currency"', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'currency' } },
          }),
          col('decided_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('department_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('exchange_rate', 'numeric(18,6)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 6 } },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('pr_number', 'text', {
            notNull: true,
            default: fn(
              "('PR-'::text || lpad((nextval('pr_number_seq'::regclass))::text, 4, '0'::text))",
            ),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('project_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('requester_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', '"pr_status"', {
            notNull: true,
            default: lit('draft'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'pr_status' } },
          }),
          col('telegram_chat_id', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('telegram_message_id', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('total_original', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('total_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_purchase_requests' }),
          checkExpression(
            'purchase_requests_exchange_rate_positive',
            '(exchange_rate > (0)::numeric)',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'role',
        columns: [
          col('id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'character varying', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_b36bcfe02fc8de3c57a8b2391c2' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'session',
        columns: [
          col('createdAt', 'timestamp', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-string@1' },
          }),
          col('deletedAt', 'timestamp', { codecRef: { codecId: 'pg/timestamp-string@1' } }),
          col('hash', 'character varying', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamp', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-string@1' },
          }),
          col('userId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_f55da76ac1c3ac420f444d2ff11' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'stock_movements',
        columns: [
          col('balance_after', 'numeric(18,4)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('delta', 'numeric(18,4)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('inventory_item_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('reason', '"movement_reason"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'movement_reason' } },
          }),
          col('ref_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('ref_table', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_stock_movements' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'stock_requests',
        columns: [
          col('approved_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('approved_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('department', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fulfilled_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('fulfilled_by', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('inventory_item_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('priority', '"stock_priority"', {
            notNull: true,
            default: lit('medium'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'stock_priority' } },
          }),
          col('qty', 'numeric(18,4)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('requester_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', '"stock_request_status"', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'stock_request_status' } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_stock_requests' }),
          checkExpression('stock_requests_qty_check', '(qty > (0)::numeric)'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'suppliers',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('address', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('bank_account', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contact_name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payment_terms_days', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('phone', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_suppliers' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'telegram_updates',
        columns: [
          col('processed_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('update_id', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
        ],
        constraints: [primaryKey(['update_id'], { name: 'PK_telegram_updates' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'user',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamp', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-string@1' },
          }),
          col('deletedAt', 'timestamp', { codecRef: { codecId: 'pg/timestamp-string@1' } }),
          col('department', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('email', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('firstName', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastName', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('must_change_password', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('password', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('payment_link', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('payment_qr_object_key', 'character varying', {
            codecRef: { codecId: 'sql/varchar@1' },
          }),
          col('photoId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('provider', 'character varying', {
            notNull: true,
            default: lit('email'),
            codecRef: { codecId: 'sql/varchar@1' },
          }),
          col('roleId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('socialId', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('telegram_id', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('telegram_link_expires_at', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('telegram_link_token', 'character varying', {
            codecRef: { codecId: 'sql/varchar@1' },
          }),
          col('telegram_username', 'character varying', { codecRef: { codecId: 'sql/varchar@1' } }),
          col('updatedAt', 'timestamp', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_cace4a159ff9f2512dd42373760' })],
      }),
      this.addUnique({
        schema: 'public',
        table: 'accounts',
        constraint: 'accounts_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'approval_thresholds',
        constraint: 'approval_thresholds_role_key',
        columns: ['role_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'auth_tokens',
        constraint: 'auth_tokens_token_hash_key',
        columns: ['token_hash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'categories',
        constraint: 'categories_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'exchange_rates',
        constraint: 'exchange_rates_date_currency_key',
        columns: ['rate_date', 'currency'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_items_sku_key',
        columns: ['sku'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'suppliers',
        constraint: 'suppliers_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'user',
        constraint: 'REL_75e2be4ce11d447ef43be0e374',
        columns: ['photoId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'user',
        constraint: 'UQ_e12875dfb3b1d92d7d7c5377e22',
        columns: ['email'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'user',
        constraint: 'user_telegram_id_key',
        columns: ['telegram_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'activity_events',
        index: 'activity_events_actor_idx',
        columns: ['actor_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'activity_events',
        index: 'activity_events_entity_idx',
        columns: ['entity_type', 'entity_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'auth_tokens',
        index: 'auth_tokens_user_idx',
        columns: ['user_id', 'purpose'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_claims',
        index: 'inventory_claims_po_idx',
        columns: ['po_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'journal_lines',
        index: 'journal_lines_account_idx',
        columns: ['account_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'journal_lines',
        index: 'journal_lines_entry_idx',
        columns: ['entry_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_user_idx',
        columns: ['user_id', 'read'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payments',
        index: 'payments_po_idx',
        columns: ['po_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'purchase_order_items',
        index: 'purchase_order_items_po_idx',
        columns: ['po_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'purchase_orders',
        index: 'purchase_orders_status_idx',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'purchase_request_items',
        index: 'purchase_request_items_pr_idx',
        columns: ['pr_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'purchase_requests',
        index: 'purchase_requests_requester_idx',
        columns: ['requester_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'purchase_requests',
        index: 'purchase_requests_status_idx',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'session',
        index: 'IDX_3d2f174ef04fb312fdebd0ddc5',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_item_idx',
        columns: ['inventory_item_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_requests',
        index: 'stock_requests_requester_idx',
        columns: ['requester_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'IDX_58e4dbff0e1a32a9bdc861bb29',
        columns: ['firstName'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'IDX_9bd2fe7a8e694dedc4ec2f666f',
        columns: ['socialId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'IDX_f0e1b4ecdca13b177e2e3a0613',
        columns: ['lastName'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user',
        index: 'user_telegram_link_token_idx',
        columns: ['telegram_link_token'],
        extras: { where: '(telegram_link_token IS NOT NULL)', unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'activity_events',
        foreignKey: {
          name: 'FK_activity_events_actor',
          columns: ['actor_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_thresholds',
        foreignKey: {
          name: 'FK_approval_thresholds_role',
          columns: ['role_id'],
          references: { schema: 'public', table: 'role', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'auth_tokens',
        foreignKey: {
          name: 'FK_auth_tokens_user',
          columns: ['user_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'budgets',
        foreignKey: {
          name: 'FK_budgets_department',
          columns: ['department_id'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'budgets',
        foreignKey: {
          name: 'FK_budgets_project',
          columns: ['project_id'],
          references: { schema: 'public', table: 'projects', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'categories',
        foreignKey: {
          name: 'FK_categories_expense_account',
          columns: ['expense_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_claims',
        foreignKey: {
          name: 'FK_inventory_claims_claimed_by',
          columns: ['claimed_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_claims',
        foreignKey: {
          name: 'FK_inventory_claims_confirmed_by',
          columns: ['confirmed_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_claims',
        foreignKey: {
          name: 'FK_inventory_claims_item',
          columns: ['inventory_item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_claims',
        foreignKey: {
          name: 'FK_inventory_claims_po',
          columns: ['po_id'],
          references: { schema: 'public', table: 'purchase_orders', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_claims',
        foreignKey: {
          name: 'FK_inventory_claims_po_item',
          columns: ['po_item_id'],
          references: { schema: 'public', table: 'purchase_order_items', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'journal_entries',
        foreignKey: {
          name: 'FK_journal_entries_created_by',
          columns: ['created_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'journal_lines',
        foreignKey: {
          name: 'FK_journal_lines_account',
          columns: ['account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'journal_lines',
        foreignKey: {
          name: 'FK_journal_lines_department',
          columns: ['dimension_department_id'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'journal_lines',
        foreignKey: {
          name: 'FK_journal_lines_entry',
          columns: ['entry_id'],
          references: { schema: 'public', table: 'journal_entries', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'journal_lines',
        foreignKey: {
          name: 'FK_journal_lines_project',
          columns: ['dimension_project_id'],
          references: { schema: 'public', table: 'projects', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'notifications',
        foreignKey: {
          name: 'FK_notifications_user',
          columns: ['user_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payments',
        foreignKey: {
          name: 'FK_payments_expense_account',
          columns: ['expense_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payments',
        foreignKey: {
          name: 'FK_payments_journal_entry',
          columns: ['journal_entry_id'],
          references: { schema: 'public', table: 'journal_entries', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payments',
        foreignKey: {
          name: 'FK_payments_po',
          columns: ['po_id'],
          references: { schema: 'public', table: 'purchase_orders', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payments',
        foreignKey: {
          name: 'FK_payments_recorded_by',
          columns: ['recorded_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_order_items',
        foreignKey: {
          name: 'FK_purchase_order_items_item',
          columns: ['inventory_item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_order_items',
        foreignKey: {
          name: 'FK_purchase_order_items_po',
          columns: ['po_id'],
          references: { schema: 'public', table: 'purchase_orders', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_orders',
        foreignKey: {
          name: 'FK_purchase_orders_created_by',
          columns: ['created_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_orders',
        foreignKey: {
          name: 'FK_purchase_orders_department',
          columns: ['department_id'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_orders',
        foreignKey: {
          name: 'FK_purchase_orders_expense_account',
          columns: ['expense_account_id'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_orders',
        foreignKey: {
          name: 'FK_purchase_orders_pr',
          columns: ['pr_id'],
          references: { schema: 'public', table: 'purchase_requests', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_orders',
        foreignKey: {
          name: 'FK_purchase_orders_project',
          columns: ['project_id'],
          references: { schema: 'public', table: 'projects', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_orders',
        foreignKey: {
          name: 'FK_purchase_orders_supplier',
          columns: ['supplier_id'],
          references: { schema: 'public', table: 'suppliers', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_request_items',
        foreignKey: {
          name: 'FK_purchase_request_items_item',
          columns: ['inventory_item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_request_items',
        foreignKey: {
          name: 'FK_purchase_request_items_pr',
          columns: ['pr_id'],
          references: { schema: 'public', table: 'purchase_requests', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_requests',
        foreignKey: {
          name: 'FK_purchase_requests_approver',
          columns: ['approver_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_requests',
        foreignKey: {
          name: 'FK_purchase_requests_department',
          columns: ['department_id'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_requests',
        foreignKey: {
          name: 'FK_purchase_requests_project',
          columns: ['project_id'],
          references: { schema: 'public', table: 'projects', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'purchase_requests',
        foreignKey: {
          name: 'FK_purchase_requests_requester',
          columns: ['requester_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'session',
        foreignKey: {
          name: 'FK_3d2f174ef04fb312fdebd0ddc53',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'FK_stock_movements_created_by',
          columns: ['created_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'FK_stock_movements_item',
          columns: ['inventory_item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_requests',
        foreignKey: {
          name: 'FK_stock_requests_approved_by',
          columns: ['approved_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_requests',
        foreignKey: {
          name: 'FK_stock_requests_fulfilled_by',
          columns: ['fulfilled_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_requests',
        foreignKey: {
          name: 'FK_stock_requests_item',
          columns: ['inventory_item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_requests',
        foreignKey: {
          name: 'FK_stock_requests_requester',
          columns: ['requester_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user',
        foreignKey: {
          name: 'FK_75e2be4ce11d447ef43be0e374f',
          columns: ['photoId'],
          references: { schema: 'public', table: 'file', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user',
        foreignKey: {
          name: 'FK_c28e52f758e7bbc53828db92194',
          columns: ['roleId'],
          references: { schema: 'public', table: 'role', columns: ['id'] },
        },
      }),
      updatedAtDefaults,
      journalBalanceTrigger,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
