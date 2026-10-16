#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a23fed17f24b50f640510a1fd3f8d84ae04c199f6510ba4bf367846716a06b1d/contract';
import startContract from '../../snapshots/a23fed17f24b50f640510a1fd3f8d84ae04c199f6510ba4bf367846716a06b1d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a40a88fec11765653d4e74fada21d1cf68d332a5a94c5c3c4024319bb1280907/contract';
import endContract from '../../snapshots/a40a88fec11765653d4e74fada21d1cf68d332a5a94c5c3c4024319bb1280907/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, rawSql } from '@prisma/orm-postgres/migration';

// Fixed random-looking starts so the first documents are not QT-0001 / C-0001. Numbers
// stay sequential from there (GDT wants invoices without gaps).
const STARTS = {
  quotation: { prefix: 'QT', start: 3817 },
  invoice: { prefix: 'INV', start: 5294 },
  receipt: { prefix: 'RCPT', start: 7461 },
};
const CUSTOMER_CODE_START = 1386;

/**
 * Not expressible in the contract: the customer code sequence (must exist before the
 * column default that calls it; existing customers get codes when the column is added),
 * and renumbering existing documents from the new starts in id order (QT-0001 becomes
 * QT-3817), with each sequence continuing after the last one. Journal memos repeat the
 * numbers, so they are rebuilt too (source compared as text: on a fresh upgrade the enum
 * values were added in the same transaction). Activity log details keep the old numbers.
 */
const numberStarts = rawSql({
  id: 'sales.number_starts',
  label: 'Customer code sequence and document number starts',
  operationClass: 'additive',
  target: {
    id: 'postgres',
    details: { schema: 'public', objectType: 'table', name: 'customers' },
  },
  precheck: [],
  execute: [
    {
      description: 'create sequence "customer_code_seq"',
      sql: `CREATE SEQUENCE IF NOT EXISTS "public"."customer_code_seq" START ${CUSTOMER_CODE_START}`,
      params: [],
    },
    ...Object.entries(STARTS).flatMap(([type, { prefix, start }]) => [
      {
        description: `renumber existing ${type} documents from ${prefix}-${start}`,
        sql: `UPDATE "public"."sales_documents" d
SET number = '${prefix}-' || lpad((${start - 1} + r.rn)::text, 4, '0')
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn
        FROM "public"."sales_documents" WHERE type = '${type}') r
WHERE d.id = r.id`,
        params: [],
      },
      {
        description: `continue "${type}_number_seq" after the last renumbered ${type}`,
        sql: `SELECT setval('"public"."${type}_number_seq"', ${start - 1} + (SELECT count(*) FROM "public"."sales_documents" WHERE type = '${type}'))`,
        params: [],
      },
    ]),
    {
      description: 'rebuild invoice journal memos with the new numbers',
      sql: `UPDATE "public"."journal_entries" j SET memo = 'Invoice ' || d.number
FROM "public"."sales_documents" d
WHERE j.source::text = 'sales_invoice' AND j.source_ref = d.id`,
      params: [],
    },
    {
      description: 'rebuild receipt journal memos with the new numbers',
      sql: `UPDATE "public"."journal_entries" j SET memo = 'Receipt ' || r.number || ' for ' || i.number
FROM "public"."sales_documents" r JOIN "public"."sales_documents" i ON i.id = r.source_id
WHERE j.source::text = 'sales_receipt' AND j.source_ref = r.id`,
      params: [],
    },
    // Recorded so a plain RESTART (test resets) goes back to the start, not to 1.
    ...Object.entries(STARTS).map(([type, { start }]) => ({
      description: `record start ${start} on "${type}_number_seq"`,
      sql: `ALTER SEQUENCE "public"."${type}_number_seq" START WITH ${start}`,
      params: [],
    })),
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      numberStarts,
      this.addColumn({
        schema: 'public',
        table: 'customers',
        column: col('code', 'text', {
          notNull: true,
          default: fn(
            "('C-'::text || lpad((nextval('customer_code_seq'::regclass))::text, 4, '0'::text))",
          ),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'customers',
        constraint: 'customers_code_key',
        columns: ['code'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
