#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/be5c79a1417961a96f87fb50660f117cfacb18d4a67407d6352dde601d10643b/contract';
import startContract from '../../snapshots/be5c79a1417961a96f87fb50660f117cfacb18d4a67407d6352dde601d10643b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e3eeb3a2e4f077e4bc0ab2e037ddc8d5ac6dc39c84d276da46f0a94ac7c0b477/contract';
import endContract from '../../snapshots/e3eeb3a2e4f077e4bc0ab2e037ddc8d5ac6dc39c84d276da46f0a94ac7c0b477/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('deposit_amount', 'numeric(18,4)', {
          notNull: true,
          default: lit('0'),
          codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('deposit_type', '"discount_type"', {
          notNull: true,
          default: lit('percent'),
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'discount_type' } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('deposit_value', 'numeric(18,4)', {
          notNull: true,
          default: lit('0'),
          codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
