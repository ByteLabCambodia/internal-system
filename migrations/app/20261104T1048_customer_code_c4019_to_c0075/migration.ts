#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/e3eeb3a2e4f077e4bc0ab2e037ddc8d5ac6dc39c84d276da46f0a94ac7c0b477/contract';
import endContract from '../../snapshots/e3eeb3a2e4f077e4bc0ab2e037ddc8d5ac6dc39c84d276da46f0a94ac7c0b477/contract.json' with { type: 'json' };
import startContract from '../../snapshots/e3eeb3a2e4f077e4bc0ab2e037ddc8d5ac6dc39c84d276da46f0a94ac7c0b477/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

/**
 * Customer C-4019 becomes C-0075. Its quotation, invoice and receipt numbers embed the code
 * (QT-4019-0001), and invoice and receipt journal memos repeat them, so all move with it.
 * A database without C-4019 (dev, test) is left alone; one where C-0075 is taken fails.
 */
const recode = rawSql({
  id: 'customers.code_c4019_to_c0075',
  label: 'Customer C-4019 becomes C-0075, with its document numbers',
  operationClass: 'data',
  target: {
    id: 'postgres',
    details: { schema: 'public', objectType: 'table', name: 'customers' },
  },
  precheck: [],
  execute: [
    {
      description: 'recode customer C-4019 and renumber its documents and journal memos',
      sql: `DO $$
DECLARE cid int;
BEGIN
  SELECT id INTO cid FROM "public"."customers" WHERE code = 'C-4019';
  IF cid IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM "public"."customers" WHERE code = 'C-0075') THEN
    RAISE EXCEPTION 'customer code C-0075 is already taken';
  END IF;
  UPDATE "public"."customers" SET code = 'C-0075' WHERE id = cid;
  UPDATE "public"."sales_documents" SET number = replace(number, '-4019-', '-0075-')
    WHERE customer_id = cid;
  UPDATE "public"."journal_entries" j SET memo = replace(j.memo, '-4019-', '-0075-')
    FROM "public"."sales_documents" d
    WHERE j.source::text IN ('sales_invoice', 'sales_receipt') AND j.source_ref = d.id
      AND d.customer_id = cid;
END $$`,
      params: [],
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [recode];
  }
}

MigrationCLI.run(import.meta.url, M);
