#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1c003d583fad60c4d63a5a31c9918b6233da0dcd39c7693b3af9a05c86a8c073/contract';
import endContract from '../../snapshots/1c003d583fad60c4d63a5a31c9918b6233da0dcd39c7693b3af9a05c86a8c073/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ddb26addd1812046725c21e2ebf4f0c501dc6ebfd4ead1d6189f1bc31236e8da/contract';
import startContract from '../../snapshots/ddb26addd1812046725c21e2ebf4f0c501dc6ebfd4ead1d6189f1bc31236e8da/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'customers',
        column: col('company', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
