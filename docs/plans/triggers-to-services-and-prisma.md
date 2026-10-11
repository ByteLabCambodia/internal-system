# Plan: move trigger logic into services, then TypeORM → Prisma

Two phases, in this order. Phase 1 keeps TypeORM and only moves business logic out of the
database. Phase 2 swaps the ORM. Doing them separately means each phase has one kind of change
to debug, and Phase 2 becomes much simpler because almost no logic is left in raw SQL.

| Phase | What | Estimate |
|---|---|---|
| 0 | Safety-net tests for the current trigger behaviour | 2–3 days |
| 1 | Move T3, T4, T5 from triggers into services (still TypeORM) | 3–4 days |
| 2 | Replace TypeORM with Prisma, module by module | 1.5–2.5 weeks |

## Status (2026-10-10)

- **Phase 0: done.** `npm run test:integration` runs 31 Postgres-backed tests in
  `test/integration/` against a disposable local database (`internal_system_test`, override
  with `TEST_DATABASE_URL`). Fixtures and assertions are plain SQL so they survive Phase 2.
- **Phase 1: done, not yet deployed.** T3, T4, T5, T1 and `set_updated_at` now live in the
  services. Migrations `1785888700000-MoveWorkflowTriggersToServices` and
  `1785888800000-MoveUsdAndTimestampsToApp` drop them (both `down`s verified). Only T2
  (`journal_lines_balanced`) remains in the database.
- **Phase 2: done.** Every service queries through Prisma ORM 8 (PRs #2, #5, #6, #7), and
  TypeORM is gone (step 5): the schema is the Prisma contract, migrations live in
  `migrations/app/` and run through `src/database/migrate.ts` (Prisma's control API, so the
  production image needs no CLI), seeds are `src/database/seeds/seed.ts`, and the app
  refuses to start on a database not signed for its contract. The TypeORM migrations are
  frozen in `src/database/legacy-migrations/`; on the first deploy, `migrate` runs the two
  production lacks, signs the database at the Prisma baseline and continues from there.
- **Prisma 8 RC quirks found so far** (worth reporting upstream):
  - An `.include()` is aliased by the relation name, so a relation named like a column
    overwrites that column. `PurchaseOrder.supplier` clashed with the legacy `supplier`
    text column, hence the relation is `supplierRecord`.
  - `forUpdate()` cannot be combined with `.include()`: lock the row, read relations
    separately.
  - Under Jest, enum writes failed because Prisma uses the host realm's `structuredClone`
    (`test/integration/support/realm.ts` works around it; plain Node is unaffected).
  - The raw lane will not bind `null`; reports use `-infinity` / `infinity` for open date
    bounds (`src/prisma/raw.ts`).
  - The runtime marker check (`verifyMarker`) only logs a warning on drift; the app does
    its own check at startup (`assertSigned`).
  - Prisma's migrator dynamically imports migration packages, which Jest cannot do without
    experimental VM modules, so tests run `migrate` in a child process.

Decisions taken: deploy Phase 1 in a short maintenance window; keep T2 only; T1 becomes
code plus `CHECK (exchange_rate > 0)`; low-stock alerts now go through
`NotificationsService.notify` (so managers/admins also get them on Telegram).

---

## Current state (what we're moving)

All triggers are created in
[1785888200000-OperationsTriggers.ts](../../src/database/migrations/1785888200000-OperationsTriggers.ts);
`on_payment_insert` was later redefined in `…400000-ClarifyOverpaymentMessage.ts` and
`…500000-OmitZeroAlreadyPaid.ts` (**the 500000 version is the current one**).

| Trigger | Fires on | Does | Decision |
|---|---|---|---|
| `set_updated_at` | BEFORE UPDATE, 15 tables | stamps `updated_at` | **Moved** → TypeORM `@UpdateDateColumn` (all 15 entities have one) |
| T1 `derive_amount_usd` / `derive_total_usd` | payments, purchase_requests, purchase_orders | computes `*_usd`, rejects rate ≤ 0 | **Moved** → `MoneyService.toUsd` in the services + `CHECK (exchange_rate > 0)` |
| T2 `journal_lines_balanced` | deferred constraint trigger on journal_lines | debits = credits per entry | **Keep** (integrity, the ledger's last line of defence) |
| T3 `on_claim_confirmed` | BEFORE UPDATE OF status, inventory_claims | over-receipt guard, stock +, stock_movement, PO line + PO status roll-up | **Move** → `ClaimsService.confirm` |
| T4 `on_stock_request_fulfilled` | BEFORE UPDATE OF status, stock_requests | insufficient-stock guard, stock −, stock_movement, auto-reorder draft PR + notifications | **Move** → `StockRequestsService.fulfil` |
| T5 `on_payment_insert` | AFTER INSERT, payments | over-payment guard, expense-account resolution, journal entry + 2 lines, PO payment_status roll-up | **Move** → `PaymentsService.record` |
| `app_setting_numeric()` | helper | reads tolerances from app_settings | **Drop** (only T3/T5 use it) |
| `guard_pr_self_approval` | — | — | Already dropped by `AllowPrSelfApproval` |

The services currently insert/update a row and turn the trigger's `RAISE EXCEPTION` into a
422 by catching `QueryFailedError`
([payments.service.ts:97](../../src/procurement/payments.service.ts#L97),
[claims.service.ts:191](../../src/inventory/claims.service.ts#L191),
[stock-requests.service.ts:157](../../src/stock/stock-requests.service.ts#L157)).

Known issues the move fixes:
- T4 inserts `notifications` rows directly, so the low-stock alert **never reaches Telegram**
  (no `NotificationsService.notify()` call), and it hard-codes `roleId IN (1, 2)`.
- `on_payment_insert` exists in three migrations; nobody can read the current rule set in one place.
- None of the workflow logic is unit-testable.

---

## Phase 0: safety-net tests

There are no unit tests and only 3 e2e specs (auth/users), so nothing would catch a regression.

1. Add a Postgres-backed integration test setup (reuse `docker-compose.relational.test.yaml`),
   with a fixture that seeds the chart of accounts (1000, 6900), a user per role, a supplier,
   an inventory item and a PO with two lines.
2. Write **characterization tests** that pin today's behaviour by calling the services:
   - **Payments (T5):** first payment; second payment (partial → paid); over-payment on first
     payment (exact message, no "already paid" clause); over-payment after a prior payment;
     `payment_tolerance_pct` honoured; direct expense (no PO) uses the given expense account;
     PO `expense_account_id` takes priority; missing accounts error; journal entry has
     `source='po_payment'`, `source_ref=payment.id`, DR expense / CR cash with dept/project
     dimensions; `payments.journal_entry_id` linked.
   - **Claims (T3):** stock increases; movement row with `balance_after`; PO line `qty_claimed`
     rolls forward; PO → `partial` then `complete`; cancelled PO status untouched; over-receipt
     rejected; `receipt_tolerance_pct` honoured; confirming twice is a no-op.
   - **Stock requests (T4):** stock decreases; insufficient-stock message; movement row;
     reorder point crossed → draft PR (`auto_generated`, `USD`, rate 1, one line of
     `reorder_qty`) + a notification per active admin/manager; not crossed → no PR.
   - **Concurrency:** two simultaneous payments that would each fit alone but together over-pay
     → exactly one succeeds. Same for two fulfilments draining the same item.
3. Run them green against the current trigger-based code. **These same tests gate Phase 1 and
   Phase 2.**

---

## Phase 1: triggers → services (still TypeORM)

Order: **T5 → T3 → T4** (T5 has the most money risk, T4 has the most side effects).

### Per workflow

For each, in the owning service:

1. Wrap the whole operation in `this.dataSource.transaction(async (manager) => …)`.
2. Lock first, exactly what the trigger locked:
   - T5: `purchase_orders` row (`setLock('pessimistic_write')`)
   - T3: `purchase_order_items` row, then `inventory_items` row
   - T4: `inventory_items` row
   Always lock in the same order (PO → PO item → inventory item) to avoid deadlocks.
3. Do the money and quantity maths with the existing `Decimal` helpers in
   [src/common/money/](../../src/common/money/), not JS numbers. Round to 4 dp like the triggers do.
4. Read tolerances via `SettingsService` (`payment_tolerance_pct`, `receipt_tolerance_pct`,
   default 0), same fallback semantics as `app_setting_numeric`.
5. Throw `UnprocessableEntityException` with **the same messages** the triggers raise (copy
   them from the 500000 migration / OperationsTriggers), and delete the `QueryFailedError` catch blocks.
6. Keep side effects that leave the system (Telegram, activity log) **after** the transaction commits.

### T5 → `PaymentsService.record`

- Move journal posting into `JournalService.postPayment(manager, …)` so accounting owns
  journal writes. It already has `recordIncome` in a transaction
  ([journal.service.ts:96](../../src/accounting/journal.service.ts#L96)). It takes the
  transaction's `manager` so it runs in the caller's transaction.
- `amount_usd` is still derived by T1. Either re-read it after insert, or compute it in code
  as well (T1 stays as the check).
- The PO `payment_status` roll-up moves into a small `PurchaseOrdersService.rollUpPaymentStatus(manager, poId)`.

### T3 → `ClaimsService.confirm`

- `InventoryService` gets `applyMovement(manager, { itemId, delta, reason, refTable, refId, actorId })`
  that updates `stock_qty`, inserts the `stock_movements` row and returns `balance_after`.
  `adjustStock` ([inventory.service.ts:176](../../src/inventory/inventory.service.ts#L176))
  should use it too. That makes one code path for every stock change.
- PO line and PO status roll-up go into `PurchaseOrdersService.rollUpReceipt(manager, poItemId, qty)`.
- The early pre-check in `ClaimsService.create` stays (it's UX); the authoritative check is
  now the locked one inside `confirm`.

### T4 → `StockRequestsService.fulfil`

- Use `InventoryService.applyMovement` with a negative delta, after the insufficient-stock check.
- Auto-reorder: create the draft PR through `PurchaseRequestsService` (not raw inserts) in
  the same transaction.
- Notifications: after commit, call `NotificationsService.notify('stock_below_reorder', …)`
  with `RoleEnum.admin, RoleEnum.manager` instead of the hard-coded ids. **Behaviour change:**
  managers now also get the alert on Telegram. Confirm that's wanted.

### Migration `DropWorkflowTriggers`

- `up`: drop triggers `payments_on_insert`, `inventory_claims_on_confirmed`,
  `stock_requests_on_fulfilled`; drop functions `on_payment_insert()`, `on_claim_confirmed()`,
  `on_stock_request_fulfilled()`, `app_setting_numeric(text, numeric)`.
- `down`: recreate them **using the latest definitions** (500000 version for `on_payment_insert`).
- Never edit the old migrations.

### Deploying Phase 1

`deploy.yml` runs migrations as a one-off ECS task **before** new tasks replace old ones. So
for a short window, old code (expecting triggers) runs against a DB without them, and payments
recorded then would get no journal entry. Choose one:

- **Simple (recommended for an internal tool):** deploy out of hours, announce a few minutes'
  freeze on recording payments, confirming claims and fulfilling stock.
- **Zero-gap:** release A changes the three triggers to return early when
  `current_setting('app.workflow_in_app', true) = 'on'`, and the new service code runs
  `SET LOCAL app.workflow_in_app = 'on'` in its transaction. Release B drops the triggers.

After deploy: compare a sample of new payments' journal entries and stock_movements against
expectations; check T2 hasn't fired any balance errors in the logs.

---

## Phase 2: TypeORM → Prisma

Scope: 28 entities, 72 files importing `typeorm`, 37 `@InjectRepository`, 20 `createQueryBuilder`
calls, 4 `dataSource.transaction` blocks, 6 seed repositories.

> Check the current Prisma docs before starting. Recent major versions changed setup
> (`prisma.config.ts`, driver adapters such as `@prisma/adapter-pg`, generated client output path).

### 2.1 Set up and baseline (no app code changes yet)

1. `npm i -D prisma` and `npm i @prisma/client` (plus the pg adapter if the current major needs it).
2. `npx prisma db pull` against a DB migrated to the latest state → `prisma/schema.prisma`.
3. Tidy the schema: PascalCase model names with `@@map("purchase_orders")`, camelCase fields
   with `@map("total_usd")`, keep Postgres enums (`po_status`, `payment_status`, …), explicit
   `@db.Decimal(18, 4)`. Note that the boilerplate `user` table uses camelCase columns
   (`"deletedAt"`, `"roleId"`) while the ops tables use snake_case.
   Don't use `@updatedAt`; `set_updated_at` keeps doing that.
4. Baseline migration:
   `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`,
   then **append the SQL for the triggers we kept** (`set_updated_at` + its 15 triggers, T1, T2)
   so a fresh database from Prisma is identical to production.
5. Mark it applied on every existing database (local, prod):
   `prisma migrate resolve --applied 0_init`. For prod, run it as a one-off ECS task like
   migrations are today.
6. Verify: `prisma migrate diff --from-url $DATABASE_URL --to-schema prisma/schema.prisma` → empty.

### 2.2 Add Prisma next to TypeORM

- Global `PrismaModule` / `PrismaService` (connect on init, disconnect on shutdown).
- Both ORMs open pools against the same RDS instance. TypeORM's pool defaults to **100**
  (`DATABASE_MAX_CONNECTIONS`), so lower it and give Prisma a small pool during the transition.
- Add a global exception filter for `Prisma.PrismaClientKnownRequestError`
  (`P2002` unique → 409/422, `P2025` not found → 404).

### 2.3 Port modules one at a time

**Rule: a transaction can't span both ORMs.** Move together any modules whose writes share a
transaction. After Phase 1 that means procurement + inventory + stock + accounting go as one
group.

| Step | Modules | Notes |
|---|---|---|
| 1 | `settings`, `activity`, `notifications`, `files` | Small, mostly CRUD. A good place to learn the patterns. |
| 2 | `telegram`, `org` (departments, projects, suppliers, thresholds) | |
| 3 | `users`, `roles`, `session`, `auth` (auth tokens) | Boilerplate domain/mapper pattern: rewrite the `relational` repository implementations and mappers; domain classes stay. |
| 4 | `procurement` + `inventory` + `stock` + `accounting` | One group. Transactions become `prisma.$transaction(async (tx) => …)`; pass `tx` instead of `manager`. Row locks become ``tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE` ``. Raise the interactive-transaction `timeout` above the 5 s default if needed. |
| 5 | `dashboard`, `admin`, reports | Most of the 20 QueryBuilder calls are here. Use `groupBy`/`aggregate` where they fit, and typed `$queryRaw` for real reports. |
| 6 | `database/seeds` | Rewrite with Prisma. |

For each step: port → run the Phase 0 tests + e2e → deploy → next step.

**Decimal gotcha:** TypeORM returns `numeric` as **strings** (the code does `String(...)` and
wraps in `Decimal`); Prisma returns `Prisma.Decimal` objects. Update the money helpers once to
accept both, and check EJS views that print amounts directly.

### 2.4 Switch the migration pipeline

- New schema changes: edit `schema.prisma` → `prisma migrate dev --name …`. For trigger or
  custom SQL, use `--create-only` and edit the SQL before applying.
- `package.json`: replace `migration:*` scripts with `prisma migrate dev|deploy`, and add
  `prisma generate` to `build` / `postinstall`.
- `deploy.yml`: the one-off ECS task runs `npx prisma migrate deploy` instead of
  `npm run migration:run:prod`.
- `Dockerfile.prod`: copy `prisma/` and make sure the generated client is in the image.

### 2.5 Remove TypeORM

- Uninstall `typeorm` and `@nestjs/typeorm`; delete `data-source.ts`,
  `typeorm-config.service.ts`, `*.entity.ts`, and `src/database/migrations/` (history stays in git).
- Delete or rewrite the hygen generators (`.hygen/generate`, `.hygen/property`, `.hygen/seeds`)
  and the `document` (Mongoose) variants. This project is Postgres-only now.
- Update [CLAUDE.md](../../CLAUDE.md) and [.claude/skills/generate/](../../.claude/skills/generate/)
  to describe the Prisma workflow.

---

## Risks

| Risk | Mitigation |
|---|---|
| Lost journal entries or stock during the Phase 1 deploy window | Freeze window or two-release flag (above) |
| Race conditions once logic leaves the DB | Same row locks as the triggers; concurrency tests in Phase 0 |
| Decimal / rounding drift (JS vs Postgres) | `Decimal` everywhere, 4-dp rounding, T1 and T2 stay as backstops |
| Prisma schema drifts from the real DB after baseline | `migrate diff` check is empty before porting; add it to CI |
| Mixed-ORM transaction bugs | Port transaction-sharing modules as one group |
| Connection exhaustion with two pools | Lower TypeORM pool during the transition |

## Open decisions

None for Phase 1 (see Status). Phase 2 decisions are taken when it starts.
