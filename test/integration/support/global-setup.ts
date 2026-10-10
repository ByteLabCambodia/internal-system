import { TEST_DATABASE_URL } from './test-db';
import { emptyDatabase, runMigrate } from './migrate-db';

/** Once per run: rebuild the test database from the migrations. Specs truncate data. */
export default async function globalSetup(): Promise<void> {
  await emptyDatabase(TEST_DATABASE_URL);
  runMigrate(TEST_DATABASE_URL);
}
