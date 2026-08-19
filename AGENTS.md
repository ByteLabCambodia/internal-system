# Operations system — agent notes

Built from `NESTJS_MIGRATION_BRIEF.md`, which is the authoritative specification.
This file records the decisions the brief left open, plus the conventions that
deviate from stock `brocoders/nestjs-boilerplate`.

## Settled decisions

### C5 — accounting basis: **(a) cash-basis**
Expense is recognized **when paid**, not when goods are received. A payment posts a
single balanced entry:

```
DR  <resolved expense account>   amount_usd
CR  1000 Cash / Bank             amount_usd
```

Account `2000 Accounts Payable` is seeded but **nothing posts to it**. There is no A/P
aging and no accrual entry on claim confirmation. Every report in the reporting layer
rests on this assumption — changing it later means reposting history.

The expense account is resolved by trigger T5 as
`coalesce(po.expense_account_id, payment.expense_account_id, account '6900')` (C1).

### Primary keys: **integer, no uuid**
Part 2 of the brief writes every PK as `uuid`. We do not use uuid. All tables — the
boilerplate's and the new ones — use integer identity PKs (`SERIAL` / `@PrimaryGeneratedColumn()`),
and every `references users (id)` in the brief becomes `integer references "user" (id)`.
The one exception is the boilerplate's pre-existing `file` table, whose uuid PK is left
untouched; no new table references it.

### Roles: **keep the boilerplate's `role` table**
Part 2 of the brief models the role as a `user_role` enum column on users. We do not do
that — the boilerplate's `role` lookup table and the `RoleEntity` relation stay, reseeded
with the four operations roles:

```
1 Admin   2 Manager   3 Finance   4 Employee   (src/roles/roles.enum.ts)
```

`approval_thresholds.role_id` is an FK to `role(id)`, and the permission matrix / guards
read `user.role.id`. There is no `user_role` Postgres enum.

The `status` table **is** dropped, replaced by `user.active boolean not null default true`
as the brief specifies. Deactivating a user sets `active = false` and kills their sessions.

## Conventions

- **Table and column naming.** New tables use `snake_case`, plural, exactly as spelled in
  Part 2 of the brief, because the raw-SQL triggers reference those names. The boilerplate's
  own `user` / `session` / `file` tables keep their camelCase columns. Entities therefore
  declare explicit `name:` on every column.
- **Module layout.** New modules follow the brief's Part 3 layout
  (`*.controller.ts`, `*.api.controller.ts`, `*.service.ts`, `entities/`, `dto/`) rather
  than the boilerplate's hexagonal `infrastructure/persistence/...` structure, which is
  kept only for the pre-existing `users` module.
- **Money.** `numeric(18,4)`, never a JS float and never TypeORM `float`/`number`. Columns
  use `numericTransformer` (`src/utils/transformers/numeric.transformer.ts`) and surface as
  `string` in TypeScript. `exchange_rate` is `numeric(18,6)` and means **units per 1 USD**;
  `amount_usd = round(amount_original / exchange_rate, 4)`, displayed at 2dp.
- **Invariants live in Postgres.** T1–T6 (Part 2.7) are raw SQL triggers inside migrations
  and are the authority. Services must **not** reimplement them — write, then re-read the row.
- **Tolerances are data, not env.** The C3 over-receipt / over-payment guards read
  `receipt_tolerance_pct` and `payment_tolerance_pct` from the `app_settings` table (both
  seeded to `0`), because a trigger cannot read the app's config. Admin → Settings edits them.

## The page layer

- **Two entry points, one guard concept.** Browser pages authenticate from an httpOnly
  cookie (`WebAuthGuard`, which refreshes a stale access token transparently); `/api/*` and
  `/docs` keep the boilerplate's bearer-token strategy and are skipped by the page guards
  and by CSRF.
- **Adding a page module?** Put its top-level URL segment in `WEB_ROUTE_PREFIXES`
  (`src/common/web/web.constants.ts`), or its routes land under `/api` and 404 in the browser.
- **Authorization is two layers.** `@RequirePermission('pr.decide')` + `PermissionsGuard`
  for who may attempt an action (the matrix lives in `src/permissions/permissions.matrix.ts`,
  transcribed from Part 1 §1), and **row scoping in every service query** for what they see —
  `PermissionsService.seesAllRows(actor)`. Scope in the repository query, never in the
  template. A missing scope is a data leak.
- **Forms are POST-redirect-GET.** Validate with `validateForm()`
  (`src/common/web/validate-form.ts`), which returns field errors instead of throwing so the
  form re-renders with the user's values intact. Every state-changing form includes
  `partials/csrf`. Flash messages ride a cookie and render as Flowbite toasts.
- **DTO gotcha:** the validator whitelists, so a property with no class-validator decorator
  is silently stripped. Decorate carry-through fields (`token`, `next`) with `@IsOptional()`.
- **Assemble pages from the partial kit**, do not invent markup: `status-badge` (the single
  status→colour map — never hand-pick a colour), `form-field`, `password-field`, `table`,
  `pagination`, `empty-state`, `alert`, `modal`, `tabs`, `timeline`, `stepper`, `page-header`,
  `icon`. Reference page: `/admin/ui-kit`.
- **EJS defaults use `locals.x`**, not `typeof x !== 'undefined'` — the latter throws a TDZ
  error when the name is also declared in the partial. Attribute-building expressions need
  `<%- %>`, not `<%= %>`, or the quotes come out HTML-escaped.
- **Front end has no bundler.** Tailwind CLI (`npm run css:build` / `css:watch`) plus three
  vendored scripts in `public/js` — Flowbite 4.0.2, Alpine, Chart.js. Never a CDN.
- **Every list page** is filter toolbar → count → sortable table → pagination → CSV
  (`partials/filter-toolbar`, `common/web/csv.ts`). The CSV runs the *same scoped query* as
  the page, so an export can never leak rows the list would hide.
- **Sorting:** URL sort keys are snake_case but TypeORM's `orderBy` needs the entity
  property once `skip`/`take` are involved. Each list service keeps a `SORTABLE` map from
  one to the other, which doubles as the allowlist.
- **EJS render locals are per-view.** Anything a template uses (`money`, `can`, …) that is
  not set by `ViewGlobalsMiddleware` or `WebAuthGuard` must be passed in *every* render call
  for that view, including the re-render on a validation failure.

## Procurement specifics

- **Money never comes from the client.** The PR/PO/payment forms post amounts, but the FX
  rate is looked up server-side and locked onto the record; a foreign currency with no rate
  on file is refused rather than defaulted to 1. Totals are summed with `MoneyService`
  (decimal.js), and `total_usd` / `amount_usd` are then **derived by trigger T1** — services
  write, then re-read.
- **A purchase order inherits the request's locked rate**, not today's, so converting later
  cannot restate an approved amount.
- **C1 lives in two places** and they must agree: `PurchaseOrdersService.resolveExpenseAccountId`
  picks the account at PO creation (one shared category → its account, otherwise 6900), and
  trigger T5 resolves `coalesce(po.expense_account_id, payment.expense_account_id, 6900)`
  when posting.
- **Guard failures surface as form errors.** The C3 over-payment guard raises inside T5;
  `PaymentsService` catches `QueryFailedError` and re-renders the form with the trigger's
  message instead of a 500.
- **C2's amount tier is still enforced**, in `PurchaseRequestsService.decide` against
  `approval_thresholds`. **C2's self-approval block is deliberately removed**, on the user's
  explicit instruction (2026-08-07): manager and admin may approve or reject their own
  purchase request. Trigger T6 (`guard_pr_self_approval`) was dropped in migration
  `1785888300000-AllowPrSelfApproval`, and the service no longer throws on it either. Since
  `pr.decide` is already restricted to manager/admin, this removes the restriction entirely
  rather than exempting specific roles — there's no third role it could apply to. Kept
  "explicit and logged" per the brief's own escape-hatch condition: every decision is
  activity-logged with the deciding actor, and a self-approval is flagged in that log
  (`detail.selfApproved: true`).
- **Storage and OCR are optional.** Without R2 credentials the receipt upload disables
  itself and the rest of the payment form still works; without `OCR_SPACE_API_KEY` the
  autofill is skipped. Neither ever throws.

## Inventory and stock

- **`inventory_items.stock_qty` is never written directly.** It moves only through trigger
  T3 (claim confirmed), trigger T4 (stock request fulfilled) and
  `InventoryService.adjustStock`. The item edit form deliberately has no stock field, so the
  balance and the `stock_movements` ledger can never disagree. `adjustStock` locks the row
  `FOR UPDATE` and writes the item and the ledger row in one transaction.
- **Guards are checked twice, on purpose.** The C3 over-receipt rule is enforced by T3 at
  confirmation (the authority) *and* re-checked in `ClaimsService.create` at submission, so
  the claimant gets "Only 1.0000 of Monitor is still outstanding" instead of a manager
  hitting a 500 later. Both read `receipt_tolerance_pct` from `app_settings`.
- **Auto-reorder is entirely T4's.** Fulfilling a request that lands at or below the reorder
  point (with `reorder_qty > 0`) inserts a draft `auto_generated` purchase request plus
  `stock_below_reorder` notifications for every active manager and admin. Nothing in the
  service layer duplicates this — it fires for the Telegram bot and the Mini App too.
- **Trigger messages surface as form errors.** `StockRequestsService.fulfil` and
  `ClaimsService.confirm` catch `QueryFailedError` and re-render with the raised message
  ("insufficient stock for SKU-MON: 4.0000 on hand, 999.0000 requested").

## Accounting, reports, dashboard

- **Reports read the ledger, not the documents.** Every money figure in P&L, cash flow,
  expense-by-category/department, transaction history and budget-vs-actual comes from
  `journal_lines`, whose USD was converted at the rate locked on the record — never today's
  rate. Currency summary, PO summary and spend-by-supplier deliberately read `payments` /
  `purchase_orders` instead, because they are about the original-currency documents.
- **Adding a report** means one method on `ReportsService` returning a `Report` (key, title,
  description, columns, rows) plus an entry in its `builders` map. The page, the date filter,
  the tab strip and the CSV route are shared — there is no per-report view.
- **Dimensions must be loaded to be inherited.** A purchase order copies the request's
  department and project, and trigger T5 stamps them onto the journal lines. If the relation
  is not loaded when the PR is fetched, every expense silently reports as "Unassigned" —
  this was a real bug caught by the expense-by-department report.
- **The daily rate cron never overwrites a manual rate** for the same day: finance's
  correction outranks the feed (`RatesService.fetchDailyRates`, 01:00, `open.er-api.com`).
  A fetch failure is logged, not thrown — the consequence is that records in that currency
  are refused until someone sets a rate, which is the safe direction.
- **Charts get their data as embedded JSON**, not a fetch: the page is already
  server-rendered, so `public/js/dashboard-charts.js` reads a `<script type="application/json">`
  block. The chart palette is the brand navy ramp plus the status hues — no second palette.

## Telegram and the Mini App

- **`NotificationsService.notify(event, payload)` is the only entry point.** Business logic
  never touches the Bot API. The routing table lives in one `routes` map, and every event
  writes in-app `notifications` rows for its recipients *before* attempting a send — the
  row is the durable record, Telegram is only the courier. Nothing here throws.
- **Deviation from Part 1 §2.8: no group chats.** The brief routes `pr_created` /
  `claim_submitted` / `stock_request_submitted` to a manager group topic and `po_created`
  to a finance group topic. On the user's explicit instruction this was changed: every
  route is a **direct message to every active user holding the target role** (manager/
  admin, or finance/admin) who has linked their own Telegram account via `/link <code>` or
  the Mini App. `TELEGRAM_MANAGER_CHAT_ID`/`TOPIC_ID`/`FINANCE_CHAT_ID`/`TOPIC_ID` and
  `TelegramService.managerChat()`/`financeChat()` were removed entirely — there is no group
  chat configuration anywhere in this integration. `pr_decided`/`claim_confirmed` still
  target the specific `recipientIds` the caller passes (the requester/claimant), unchanged.
- **Deviation from Part 1 §2.8: no inline approve/reject buttons.** The brief specifies
  tappable Approve/Reject/Confirm/Fulfil buttons that decide the record from inside
  Telegram via callback data. Removed on the user's explicit instruction (2026-08-07),
  because a decision made anywhere *other than* the exact tap — the website, or a different
  recipient's copy of the same fanned-out message — had no way to go back and update the
  stale buttons (reported live: "I approve on the website but Telegram doesn't update").
  Every notification's keyboard is now a single **URL button** to the live page
  (`NotificationsService.linkFor`) — `pr_created` → `/purchase-requests/:id`,
  `stock_request_submitted` → `/stock-requests/:id`, `claim_submitted` → `/claims` (no
  per-claim page exists). A link button has no state to go stale: it always opens the real
  page, which always shows what's true right now, and the normal permission guard on that
  page still applies — this is a shortcut to the form, not a bypass of it.
  `TelegramCallbacksService` and the webhook's `callback_query` handling were deleted
  entirely as a result (nothing produces that data anymore); `setWebhook`'s
  `allowed_updates` dropped to `['message']`.
- **The webhook is exempt from CSRF** (`/telegram/webhook` only) because the caller is
  Telegram, not a browser with our cookies. It authenticates with the secret-token header
  and de-duplicates by inserting `update_id` into `telegram_updates` first — a replay loses
  the primary-key race and is dropped. Every other `/telegram/*` route keeps CSRF.
- **The Mini App is split across the prefix boundary.** The EJS shell is a page at
  `/miniapp` (excluded from the `api` prefix via `MINIAPP_SHELL_PATH`), while its JSON API
  deliberately keeps the prefix at `/api/v1/miniapp/*`. Do not add `miniapp` back to
  `WEB_ROUTE_PREFIXES` — that pulls the API out of the prefix and into CSRF.
- **initData is verified, not trusted:** HMAC-SHA256 with a key derived from the bot token,
  compared in constant time, with a 24h `auth_date` cap. A valid signature from an unlinked
  Telegram id is authenticated but has no profile — the API answers `{linked: false}` and
  the client shows the link screen.
- **Everything degrades without a bot token.** No token means no sends, no bot; the web app,
  the in-app notifications and the Mini App shell all still work.

## Admin

- **Account creation has two modes on one form** and they must stay distinct: *invite*
  stores no password and mails a 7-day single-use link; *set password now* stores one and
  sets `must_change_password`, so the admin's choice can never remain the user's password.
  Setting a password from the edit form additionally invalidates any pending invite, kills
  every session, and writes an `activity_events` row naming the admin who did it.
- **Session revocation is a soft delete** (`session.deletedAt`). Counting rows in `session`
  will look like nothing happened — filter on `"deletedAt" IS NULL` to see live sessions.
- **Approval limits have three states, not two:** a row with a null limit (unlimited), a row
  with a ceiling, and *no row at all* (cannot approve). A blank amount means the last of
  those, so the settings form carries an explicit "unlimited" checkbox — treating blank as
  unlimited would silently grant approval rights to every role.
- **Delete is guarded, deactivate is the norm.** Users, departments, projects, suppliers and
  categories all refuse to delete when records reference them, and the last active admin and
  self-deletion are blocked outright.
- **`repository.delete({ relation: { id } })` silently matches nothing.** TypeORM does not
  translate relation criteria for deletes — it reports success having deleted zero rows. Use
  the query builder with the FK column (see `ApprovalThresholdsService.removeLimit`).

## Build gotcha

`nest build` is incremental and keeps its state in `dist/tsconfig.build.tsbuildinfo`. If a
build is interrupted or two builds overlap, tsc can conclude everything is up to date while
`dist/` is missing its output, and the server then fails with
`Cannot find module '.../dist/main'` even though the build exited 0. Fix: `rm -rf dist`,
build again, and check `dist/main.js` exists before starting.

Also: build with **`npm run build`**, never bare `tsc`. `nest build` copies the i18n JSON
assets into `dist/`; a raw `tsc` run compiles cleanly but the app then dies at boot with
`i18n path (dist/i18n/) cannot be found`.

## Flowbite

`docs/flowbite-llms-full.txt` is the authoritative source for component markup — grep it per
component, never write Flowbite markup from memory, and ignore Flowbite React/Svelte docs.

The `flowbite` MCP server is configured for this project (`npx -y flowbite-mcp`). It does
**theme generation**, not markup lookup — use it once in phase 2 to produce the theme file,
then work from `llms-full.txt` for every component.

### Brand palette

```
primary (light)   #213a63   deep navy — nav, primary buttons, links, active states
primary (dark)    #2563eb   bright blue accent — same roles, dark mode only
neutral           #000000 / #ffffff   text and surfaces, light and dark mode
```

`primary-*` is defined as CSS variables in `app.css` (`:root` for light, `.dark` for dark)
rather than a single static Tailwind palette, so the same `bg-primary-600`/`text-primary-500`
etc. classes resolve to navy in light mode and a bright blue in dark mode automatically —
no `dark:` variant needed per usage. Dark mode's surfaces (`gray-*`, remapped to a true
neutral scale — see `tailwind.config.js`) stay dark and neutral; primary needed a color
that visibly pops against them rather than one closer to black, which blended into
gray-800/900 backgrounds and lost all contrast as an interactive/CTA color.

Note this puts primary's dark-mode value in the same hue family as the "blue" entry in the
status colour map below — a real, currently-unresolved tension with the original
"never competes with a status badge" goal, worth revisiting if a blue status badge next to
a primary button/link reads ambiguously in dark mode.

Black, white and the navy/blue-accent primary are the whole identity — status colours
(Part 1c's one status colour map: grey / amber / blue / indigo / green / red / orange) are
functional, not brand, and are the only other hues on screen. Primary is reserved for
interactive and navigational elements so it never competes with a status badge for
attention.
