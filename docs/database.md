# Database

PostgreSQL, through [Prisma ORM 8](https://www.prisma.io) (release candidate).

## Table of Contents <!-- omit in toc -->

- [Where things live](#where-things-live)
- [Changing the schema](#changing-the-schema)
- [Applying migrations](#applying-migrations)
- [Seeding](#seeding)
- [Querying](#querying)
- [The cutover from TypeORM](#the-cutover-from-typeorm)
- [Max connections](#max-connections)

## Where things live

| What | Where |
| --- | --- |
| The data contract (schema) | `src/prisma/contract.prisma`, emitted to `contract.json` / `contract.d.ts` |
| Migrations | `migrations/app/<timestamp>_<name>/`, contract snapshots in `migrations/snapshots/` |
| The migrator | `src/database/migrate.ts` |
| Seeds | `src/database/seeds/seed.ts` |
| The client | `src/prisma/prisma.service.ts` (`PrismaService.db`) |

## Changing the schema

1. Edit `src/prisma/contract.prisma`.
2. `npm run prisma:emit`
3. `npm run migration:plan -- <snake_case_name>`. The plan's `from:` must be the previous
   migration's hash, never `(baseline)`. Fill in any `placeholder(...)` data transforms in
   the new `migration.ts`, then re-emit it with `node migrations/app/<dir>/migration.ts`.
4. `npm run migrate`, then `npx prisma db verify --db "$DATABASE_URL"`.

Never edit a migration that has been merged; plan a new one. The
[schema-change skill](../.claude/skills/schema-change/SKILL.md) has the conventions
(snake_case mapping, money as `Numeric(18, 4)`, timestamps).

## Applying migrations

`npm run migrate` (development, ts-node) and `npm run migrate:prod` (compiled, used by the
deploy's one-off ECS task before new tasks start) both run `src/database/migrate.ts`. It
uses Prisma's control API rather than its CLI, which the production image does not carry,
and applies every pending migration in one transaction.

At startup the app checks that the database is signed with the contract it was built
from, and refuses to start otherwise (`PRISMA_VERIFY_MARKER=false` skips the check).

## Seeding

`npm run seed` (or `seed:prod`) inserts whatever is missing: the four roles, the chart of
accounts, categories, approval limits, tolerance settings, one development login per role,
and the `ADMIN_EMAIL` account if set. Re-running it changes nothing.

## Querying

```ts
const orders = await this.prisma.db.orm.public.PurchaseOrder
  .where({ status: 'open' })
  .include('supplierRecord')
  .orderBy((po) => po.createdAt.desc())
  .limit(20)
  .all();
```

Transactions are `this.prisma.db.transaction(async (tx) => …)`; pass `tx` to anything that
must join it, and lock rows with `.forUpdate()`. Numerics come back as strings and
timestamps as Postgres text (`toDate()` in `src/prisma/dates.ts` converts). Reports use
the raw lane (`db.raw.sql`), see `src/prisma/raw.ts`.

## The cutover from TypeORM

The schema used to be built by TypeORM migrations, now frozen in
`src/database/legacy-migrations/`. The Prisma baseline migration reproduces exactly the
schema they built. When `migrate` meets a database TypeORM built and nobody has signed
(production at the cutover), it runs whichever of those old migrations it lacks, signs the
database at the baseline, and continues with Prisma's migrations.
`test/integration/migrations.int-spec.ts` checks that path on every run.

## Max connections

`DATABASE_MAX_CONNECTIONS` sizes the app's pool (per ECS task). The production
`db.t4g.micro` allows roughly 80–110 connections in total.

---

Previous: [Architecture](architecture.md)

Next: [Auth](auth.md)
