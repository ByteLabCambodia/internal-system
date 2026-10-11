#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1c003d583fad60c4d63a5a31c9918b6233da0dcd39c7693b3af9a05c86a8c073/contract';
import startContract from '../../snapshots/1c003d583fad60c4d63a5a31c9918b6233da0dcd39c7693b3af9a05c86a8c073/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a23fed17f24b50f640510a1fd3f8d84ae04c199f6510ba4bf367846716a06b1d/contract';
import endContract from '../../snapshots/a23fed17f24b50f640510a1fd3f8d84ae04c199f6510ba4bf367846716a06b1d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: 'public', table: 'customers', column: 'contact_name' })];
  }
}

MigrationCLI.run(import.meta.url, M);
