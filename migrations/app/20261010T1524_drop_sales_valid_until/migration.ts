#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0bb22c1d011823d231e0d9ff5557695cec104c7e31bacd9f4f3db358a1ee5f3e/contract';
import startContract from '../../snapshots/0bb22c1d011823d231e0d9ff5557695cec104c7e31bacd9f4f3db358a1ee5f3e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/343d0a86f7853d10b490aaad0f21df774e4c112636e7e161c35184cdb01182a4/contract';
import endContract from '../../snapshots/343d0a86f7853d10b490aaad0f21df774e4c112636e7e161c35184cdb01182a4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: 'public', table: 'sales_documents', column: 'valid_until' })];
  }
}

MigrationCLI.run(import.meta.url, M);
