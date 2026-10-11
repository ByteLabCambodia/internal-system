#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/02adea2b18992d7fdbf72787a61c7fcb03ea5533794c0408a3ad007d0879ffe5/contract';
import endContract from '../../snapshots/02adea2b18992d7fdbf72787a61c7fcb03ea5533794c0408a3ad007d0879ffe5/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/569cd35f4c53b282ab5083d855b2617be5776e9553e22a11c83024c89406e903/contract';
import startContract from '../../snapshots/569cd35f4c53b282ab5083d855b2617be5776e9553e22a11c83024c89406e903/contract.json' with { type: 'json' };
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
 * Not expressible in the contract: one number sequence per document type (SalesService
 * formats QT-/INV-/RCPT-), updated_at defaults for raw inserts as in the baseline, and
 * the two accounts invoices post to.
 */
const salesSupport = rawSql({
  id: 'sales.support',
  label: 'Sales number sequences, updated_at defaults, receivable and VAT accounts',
  operationClass: 'additive',
  target: {
    id: 'postgres',
    details: { schema: 'public', objectType: 'table', name: 'sales_documents' },
  },
  precheck: [],
  execute: [
    ...['quotation', 'invoice', 'receipt'].map((type) => ({
      description: `create sequence "${type}_number_seq"`,
      sql: `CREATE SEQUENCE IF NOT EXISTS "public"."${type}_number_seq"`,
      params: [],
    })),
    ...['customers', 'sales_documents'].map((table) => ({
      description: `default "${table}".updated_at to now()`,
      sql: `ALTER TABLE "public"."${table}" ALTER COLUMN "updated_at" SET DEFAULT now()`,
      params: [],
    })),
    {
      description: 'insert accounts 1100 Accounts Receivable and 2100 VAT Payable',
      sql: `INSERT INTO "public"."accounts" (code, name, type, updated_at) VALUES
  ('1100', 'Accounts Receivable', 'asset', now()),
  ('2100', 'VAT Payable', 'liability', now())
ON CONFLICT (code) DO NOTHING`,
      params: [],
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'journal_source',
        value: 'sales_invoice',
      }),
      this.addNativeEnumValue({
        schema: 'public',
        typeName: 'journal_source',
        value: 'sales_receipt',
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'sales_doc_status',
        members: ['draft', 'sent', 'accepted', 'rejected', 'issued', 'paid', 'void'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'sales_doc_type',
        members: ['quotation', 'invoice', 'receipt'],
      }),
      this.createTable({
        schema: 'public',
        table: 'customers',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('address', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
          col('phone', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('vat_tin', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_customers' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_document_items',
        columns: [
          col('amount', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('detail', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('document_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('qty', 'numeric(18,4)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('unit_price', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'PK_sales_document_items' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_documents',
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
          col('customer_id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('due_date', 'date', { codecRef: { codecId: 'pg/date-string@1' } }),
          col('exchange_rate', 'numeric(18,6)', {
            notNull: true,
            default: lit('1'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 6 } },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('issue_date', 'date', {
            notNull: true,
            default: fn('CURRENT_DATE'),
            codecRef: { codecId: 'pg/date-string@1' },
          }),
          col('journal_entry_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('number', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payment_method', '"payment_method"', {
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'payment_method' } },
          }),
          col('payment_reference', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('status', '"sales_doc_status"', {
            notNull: true,
            default: lit('draft'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'sales_doc_status' } },
          }),
          col('subtotal', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('total', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('total_usd', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('type', '"sales_doc_type"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'sales_doc_type' } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('valid_until', 'date', { codecRef: { codecId: 'pg/date-string@1' } }),
          col('vat_amount', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
          col('vat_rate', 'numeric(18,4)', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'PK_sales_documents' }),
          checkExpression(
            'sales_documents_exchange_rate_positive',
            '(exchange_rate > (0)::numeric)',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'customers',
        constraint: 'customers_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sales_documents',
        constraint: 'sales_documents_number_key',
        columns: ['number'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_document_items',
        index: 'sales_document_items_document_idx',
        columns: ['document_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_documents',
        index: 'sales_documents_customer_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_documents',
        index: 'sales_documents_source_idx',
        columns: ['source_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_documents',
        index: 'sales_documents_type_status_idx',
        columns: ['type', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_document_items',
        foreignKey: {
          name: 'FK_sales_document_items_document',
          columns: ['document_id'],
          references: { schema: 'public', table: 'sales_documents', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_documents',
        foreignKey: {
          name: 'FK_sales_documents_customer',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customers', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_documents',
        foreignKey: {
          name: 'FK_sales_documents_source',
          columns: ['source_id'],
          references: { schema: 'public', table: 'sales_documents', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_documents',
        foreignKey: {
          name: 'FK_sales_documents_journal_entry',
          columns: ['journal_entry_id'],
          references: { schema: 'public', table: 'journal_entries', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_documents',
        foreignKey: {
          name: 'FK_sales_documents_created_by',
          columns: ['created_by'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      salesSupport,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
