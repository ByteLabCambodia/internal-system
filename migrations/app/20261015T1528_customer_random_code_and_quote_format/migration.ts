#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a40a88fec11765653d4e74fada21d1cf68d332a5a94c5c3c4024319bb1280907/contract';
import startContract from '../../snapshots/a40a88fec11765653d4e74fada21d1cf68d332a5a94c5c3c4024319bb1280907/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/be5c79a1417961a96f87fb50660f117cfacb18d4a67407d6352dde601d10643b/contract';
import endContract from '../../snapshots/be5c79a1417961a96f87fb50660f117cfacb18d4a67407d6352dde601d10643b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, rawSql } from '@prisma/orm-postgres/migration';

const target = {
  id: 'postgres',
  details: { schema: 'public', objectType: 'table', name: 'customers' },
} as const;

/** Not expressible in the contract: the function the new customers.code default calls. */
const randomCode = rawSql({
  id: 'customers.random_code_function',
  label: 'random_customer_code(): a random unused C-1000..C-9999',
  operationClass: 'additive',
  target,
  precheck: [],
  execute: [
    {
      description: 'create function random_customer_code()',
      // shortcut: loops forever once all 9000 codes are taken; widen the range before ~5000 customers.
      sql: `CREATE OR REPLACE FUNCTION "public"."random_customer_code"() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE candidate text;
BEGIN
  LOOP
    candidate := 'C-' || (1000 + floor(random() * 9000))::int;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "public"."customers" WHERE code = candidate);
  END LOOP;
  RETURN candidate;
END $$`,
      params: [],
    },
  ],
  postcheck: [],
});

/**
 * Existing customers move from the sequential codes to random ones (one row per statement,
 * so each new code sees the ones before it), and existing documents to
 * <prefix>-<customer code>-<nth of that type for that customer>, in id order. Journal
 * memos repeat the numbers, so they are rebuilt (source compared as text, as in the
 * previous migration). The number sequences and customer code sequence are no longer used.
 */
const recode = rawSql({
  id: 'customers.random_codes_and_quote_numbers',
  label: 'Random customer codes and per-customer document numbers',
  operationClass: 'data',
  target,
  precheck: [],
  execute: [
    {
      description: 'give every existing customer a random code',
      sql: `DO $$
DECLARE row record;
BEGIN
  FOR row IN SELECT id FROM "public"."customers" ORDER BY id LOOP
    UPDATE "public"."customers" SET code = "public"."random_customer_code"() WHERE id = row.id;
  END LOOP;
END $$`,
      params: [],
    },
    {
      description: 'renumber documents as <prefix>-<customer code>-<nth>',
      sql: `UPDATE "public"."sales_documents" d
SET number = CASE d.type::text WHEN 'quotation' THEN 'QT' WHEN 'invoice' THEN 'INV' ELSE 'RCPT' END
  || '-' || substr(c.code, 3) || '-' || lpad(r.rn::text, 4, '0')
FROM (SELECT id, row_number() OVER (PARTITION BY customer_id, type ORDER BY id) AS rn
        FROM "public"."sales_documents") r,
     "public"."customers" c
WHERE d.id = r.id AND c.id = d.customer_id`,
      params: [],
    },
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
    {
      description: 'drop the unused number and customer code sequences',
      sql: `DROP SEQUENCE IF EXISTS "public"."quotation_number_seq", "public"."invoice_number_seq",
  "public"."receipt_number_seq", "public"."customer_code_seq"`,
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
      randomCode,
      this.setDefault({
        schema: 'public',
        table: 'customers',
        column: col('code', 'text', {
          default: fn('random_customer_code()'),
          codecRef: { codecId: 'pg/text@1' },
        }),
        operationClass: 'widening',
      }),
      recode,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
