#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/02adea2b18992d7fdbf72787a61c7fcb03ea5533794c0408a3ad007d0879ffe5/contract';
import startContract from '../../snapshots/02adea2b18992d7fdbf72787a61c7fcb03ea5533794c0408a3ad007d0879ffe5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/0bb22c1d011823d231e0d9ff5557695cec104c7e31bacd9f4f3db358a1ee5f3e/contract';
import endContract from '../../snapshots/0bb22c1d011823d231e0d9ff5557695cec104c7e31bacd9f4f3db358a1ee5f3e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'discount_type',
        members: ['percent', 'amount'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'sales_doc_language',
        members: ['both', 'km', 'en'],
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('discount_amount', 'numeric(18,4)', {
          notNull: true,
          default: lit('0'),
          codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('discount_type', '"discount_type"', {
          notNull: true,
          default: lit('percent'),
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'discount_type' } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('discount_value', 'numeric(18,4)', {
          notNull: true,
          default: lit('0'),
          codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 18, scale: 4 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales_documents',
        column: col('language', '"sales_doc_language"', {
          notNull: true,
          default: lit('both'),
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'sales_doc_language' } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
