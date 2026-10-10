import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TestingModule } from '@nestjs/testing';
import { createTestApp, TEST_DATABASE_URL } from './support/test-app';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * While TypeORM migrations still own the schema, src/prisma/contract.prisma must keep
 * describing what they build. A migration without the matching contract change fails here.
 */
describe('Prisma contract', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await createTestApp(); // drops the schema and runs every migration
  });

  afterAll(() => app.close());

  it('should match the schema the migrations build', async () => {
    const { stdout } = await promisify(execFile)(
      'npx',
      [
        'prisma',
        'db',
        'verify',
        '--schema-only',
        '--db',
        TEST_DATABASE_URL,
        '--json',
      ],
      { env: { ...process.env, PRISMA_DISABLE_TELEMETRY: '1' } },
    ).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }));

    const result = stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((line) => line.kind === 'result');

    expect(result?.envelope).toMatchObject({ ok: true });
  });

  it('should query through the Prisma ORM 8 client', async () => {
    const roles = await app
      .get(PrismaService)
      .db.orm.public.Role.orderBy((r) => r.id.asc())
      .all();
    expect(Array.isArray(roles)).toBe(true);
  });
});
