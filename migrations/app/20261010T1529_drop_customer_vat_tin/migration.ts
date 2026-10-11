#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/343d0a86f7853d10b490aaad0f21df774e4c112636e7e161c35184cdb01182a4/contract';
import startContract from '../../snapshots/343d0a86f7853d10b490aaad0f21df774e4c112636e7e161c35184cdb01182a4/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ddb26addd1812046725c21e2ebf4f0c501dc6ebfd4ead1d6189f1bc31236e8da/contract';
import endContract from '../../snapshots/ddb26addd1812046725c21e2ebf4f0c501dc6ebfd4ead1d6189f1bc31236e8da/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: 'public', table: 'customers', column: 'vat_tin' })];
  }
}

MigrationCLI.run(import.meta.url, M);
