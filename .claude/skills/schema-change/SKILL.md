---
name: schema-change
description: Change the database schema in this project (add or change a table, column, index, enum or relation) with Prisma ORM 8: edit src/prisma/contract.prisma, emit, plan a migration, apply and test it. Use for any schema change.
---

# Changing the database schema

The schema is described by the Prisma contract, `src/prisma/contract.prisma`. Migrations
are planned from it into `migrations/app/<timestamp>_<name>/` and applied by
`src/database/migrate.ts` (locally `pnpm run migrate`, in production the deploy's one-off
ECS task runs `pnpm run migrate:prod`). There are no entity classes and no generators.

## Steps

1. **Edit the contract.** Follow the file's conventions:
   - Table and column names are snake_case in the database: `@@map("table_name")` on the
     model, `@map("column_name")` on each camelCase field. The boilerplate's `user`,
     `session` and `file` tables are the exception (camelCase columns).
   - Money is `Numeric(18, 4)`, exchange rates `Numeric(18, 6)`. They read back as
     strings; write them through `money()` / `rate()` from `src/prisma/numeric.ts`.
   - Timestamps are `TimestamptzString`; `updatedAt` is
     `temporal.updatedAtString() @map("updated_at")`.
   - A relation must not share its name with a column (an include is aliased by the
     relation name and would overwrite the column; see `PurchaseOrder.supplierRecord`).
2. **Emit:** `pnpm run prisma:emit` (writes `src/prisma/contract.json` and `contract.d.ts`).
3. **Plan:** `pnpm run migration:plan -- <snake_name>`. Read the `from:` line: it must be
   the previous migration's hash, never `(baseline)`. If the plan needs a data backfill,
   `migration.ts` contains `placeholder(...)`: fill it in, then self-emit with
   `node migrations/app/<dir>/migration.ts`. Anything the contract cannot describe
   (sequences, triggers, functions) goes in as a `rawSql({...})` operation, as in the
   baseline migration.
4. **Apply locally:** `pnpm run migrate`, then `pnpm exec prisma db verify --db "$DATABASE_URL"`.
5. **Use it** in services through `PrismaService` (`this.prisma.db.orm.public.Model`).
6. **Test:** `pnpm run test:integration` rebuilds the test database from the migrations,
   and `test/integration/migrations.int-spec.ts` checks the upgrade path still yields the
   same schema. Run `pnpm run test:browser` for anything a page shows.

## Never

- Edit an existing migration after it has been merged: plan a new one.
- Touch `src/database/legacy-migrations/`: frozen TypeORM-era history, only there to bring
  an old database up to the Prisma baseline.
- Hand-edit `ops.json` / `migration.json`: re-emit from `migration.ts`.
