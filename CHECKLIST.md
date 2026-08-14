# Build checklist — operations system

Generated from `NESTJS_MIGRATION_BRIEF.md`. Every item below was checked against the
running app, the schema, or the source — not assumed. Items with a note explain what was
verified and how; items marked **deferred** are explicitly out of scope per the brief.

Legend: ✅ done and verified · ⚠️ built but not exercised against a live third party ·
⏸️ deferred (brief says so) · 📋 your decision (brief says ask, don't guess)

---

## Part 1 §1 — Roles & permission matrix

- ✅ Four roles: `employee`, `manager`, `finance`, `admin` (kept as the boilerplate's `role`
  table, reseeded — see AGENTS.md "Settled decisions")
- ✅ Full 15-permission × 4-role matrix, transcribed verbatim in
  `src/permissions/permissions.matrix.ts`
- ✅ `suppliers.manage` added per Part 1b/C4
- ✅ Guards: `@RequirePermission` + `PermissionsGuard`, global, skips `/api` and `/docs`
- ✅ Row scoping in every service query (not the template) — verified: employee sees only
  their own PRs/POs/claims/stock requests; manager/finance/admin see all
- ✅ Notifications scoped to `own only` — no cross-user route exists

## Part 1 §2.1 — Procurement

- ✅ PR: sequential `PR-0001`, statuses draft→pending→approved|rejected|cancelled→converted,
  multi-line items, currency lock at submit, department/project, note, requester/approver,
  `auto_generated` flag
- ⚠️ `telegram_message_id`/`telegram_chat_id` columns exist on the entity but nothing writes
  them yet — the brief ties them to the approval message, which needs a live bot to test
- ✅ PO: sequential `PO-0001`, created from an approved PR (flips PR to converted), type
  online/physical, supplier, locked rate, status open→partial→complete|cancelled, payment
  status unpaid→partial→paid, `qty_ordered`/`qty_claimed` per line
- ✅ Payments: PO or standalone, amount+currency+locked rate→`amount_usd`, method, bank
  fields, receipt key, auto journal entry (T5), payment-status rollup
- ⚠️ Receipt OCR: OCR.space engine 2 table-mode parser built and unit-verified against a
  sample tab-separated payload; never called against the live API (no `OCR_SPACE_API_KEY`)
- ✅ Payment destination on profile: link + QR upload, surfaced via `paymentLink`/QR fields
- ✅ Unified flow stepper: Requested→Approved→Ordered→Paid→Received, derived in
  `flow-stepper.ts`, not stored
- ✅ Cancel flows for PR and PO, with status guards (can't cancel complete/already-cancelled)

## Part 1 §2.2 — Inventory

- ✅ Catalog items: sku (unique, case-insensitive check), name, category, unit, stock_qty,
  reorder_point, reorder_qty, active
- ✅ Categories: managed list, seeded Electronics/Office Supplies/Tools/Materials, each with
  an `expense_account_id` (C1)
- ✅ Claims: submit against a PO line → pending→confirmed|rejected; confirm moves stock,
  appends ledger row, advances `qty_claimed`, recomputes PO status (trigger T3)
- ✅ Manual adjustment: manager/admin only, transactional, row-locked, refuses negative
- ✅ Stock movements ledger: append-only, delta/reason/ref/balance_after/actor, written only
  by triggers + `adjustStock`
- ✅ Item detail page: info, current stock, movement history

## Part 1 §2.3 — Stock requests

- ✅ Request: qty, priority, department, note
- ✅ pending→approved→fulfilled|rejected
- ✅ Fulfil: decrements (fails if insufficient — trigger-raised, caught and shown as a form
  error), movement appended
- ✅ **Auto-reorder**: verified live — fulfilling into the reorder point raised a draft
  `auto_generated` PR with one line for `reorder_qty`, plus `stock_below_reorder`
  notifications for every active manager/admin

## Part 1 §2.4 — Accounting

- ✅ Chart of accounts seeded exactly as specified (1000/2000/3000/4000/6000/6100/6900)
- ✅ Journal entries + lines, double-entry USD, one-sided check constraint, balance enforced
  by deferred trigger T2 (verified: an unbalanced insert was rejected at commit)
- ✅ Manual income: DR Cash / CR chosen income account, balanced
- ✅ Exchange rates: one row per (date, currency), manual override, daily cron
  (`fetchDailyRates`, 01:00) — cron logic verified not to clobber a same-day manual rate;
  the live fetch itself wasn't exercised (no outbound call made during testing)
- ✅ `getCurrentRate()` — most recent rate on/before today, USD always 1
- ⏸️ Budgets — table + report exist; **CRUD explicitly deferred** by the brief ("Minimum
  viable follow-up... not required for feature parity")

## Part 1 §2.5 — Reports

All eight, plus spend-by-supplier (C4), each with date-range filter and CSV export —
verified individually against seeded data:

- ✅ Profit & Loss by month
- ✅ Cash flow by month
- ✅ **Expense by category — the C1 acceptance test.** Returns 3 rows (6000/6100/6900), not
  the legacy single row
- ✅ Expense by department (bug found and fixed: PO wasn't inheriting the PR's department
  relation — see AGENTS.md)
- ✅ Currency summary
- ✅ PO summary
- ✅ Transaction history
- ✅ Budget vs actual (reports correctly on the empty `budgets` table)
- ✅ Spend by supplier (C4)

## Part 1 §2.6 — Dashboard

- ✅ KPI cards: my pending requests, low-stock items, open POs; expense/cash balance for
  accounting-view roles; pending-approvals card for `pr.decide` roles (bug found and fixed:
  was in a dead `else if` branch, never shown to managers)
- ✅ Three Chart.js charts: P&L, expense by category, expense by department — data embedded
  as JSON, no client fetch
- ✅ Activity feed: orders/payments/claims/stock requests unioned, newest first
- ✅ Notifications panel: unread rows for the signed-in user

## Part 1 §2.7 — Activity timeline

- ✅ `activity_events` table, rendered via `partials/timeline` on PR/PO/payment/stock-request
  detail pages (and inventory items, users)
- ✅ Written best-effort from every state-changing action; `ActivityService.log` catches its
  own errors and never rolls back the caller

## Part 1 §2.8 — Telegram integration

- ✅ Single `notify(event, payload)` abstraction — grepped: no controller/service calls the
  Bot API directly except through `TelegramService`
- ✅ All 9 events wired: `pr_created`, `pr_decided`, `po_created`, `payment_recorded`,
  `claim_submitted`, `claim_confirmed`, `stock_request_submitted`, `stock_below_reorder`,
  `exchange_rate_updated`
- ⚠️ **Routing deviates from the spec, on the user's explicit instruction (2026-08-07):
  no group chats.** All manager/finance-group events now DM every active user in that role
  who has linked Telegram, the same way `payment_recorded`/`stock_below_reorder` always
  did. Verified live: a submitted PR wrote in-app rows only to manager+admin, none to
  finance, zero Telegram sends attempted with nobody linked.
- ✅ In-app `notifications` row written on every send, independent of Telegram's own success
- ⚠️ **Inline approve/reject buttons deviate from the spec too, same date.** Replaced with a
  single URL button to the live page (`pr_created`→PR detail, `stock_request_submitted`→
  stock request detail, `claim_submitted`→the claims list). Root cause: a decision made
  anywhere other than the exact button tapped had no way to update the other stale copies
  — reported live as "I approve on the website but Telegram doesn't update." `TelegramCallbacksService`
  and the webhook's `callback_query` handling were deleted as a result. The permission/
  threshold/self-approval checks the old callback path exercised still apply, unchanged —
  they live on the destination page, not in the button.
- ✅ Webhook hardening: secret-token header enforced (403 without/with wrong token) +
  `telegram_updates` idempotency (verified: replayed `update_id` returns
  `{"duplicate":true}`, table unchanged)
- ✅ Account linking: `/link <code>` one-time token (15 min) + credentials endpoint for the
  Mini App; unlink from profile
- ✅ Webhook setup endpoint (`POST /telegram/setup`, admin-only)
- ⚠️ Verified with a **test** bot token/secret, then reverted to unconfigured — real sends to
  Telegram's actual API (especially group/topic delivery) were never exercised

## Part 1 §2.9 — Telegram Mini App

- ✅ Separate shell (`/miniapp`, no cookie), initData HMAC auth
  (`MiniAppAuthGuard`) — verified: missing/forged initData → 401, valid → 200, valid-but-
  unlinked → `{linked:false}`; shell HTML loads clean, `miniapp.js` passes `node -c`
- ✅ Screens: link, home, PR form, stock request form, claim form, submitted, history
  (list + PR/claim/stock detail) — client-rendered, no page reloads
- ✅ API surface matches spec: `data`, `pr`, `stock`, `claim`, `history`,
  `history/pr/:id`, `history/claim/:id`, `history/stock/:id`, `notify`
- ✅ Row-scoped through the same services as the browser — verified: employee's history
  excludes the manager's records, detail endpoint 404s on another user's PR
- ✅ Credentials-based linking (the in-app "link account" screen, distinct from the bot's
  `/link <code>`) — verified live: wrong password → 422 with the same generic message the
  web login uses, a Telegram id already linked to one profile is refused for another, and
  a full round trip (link → `data()` returns the real profile and catalog → submit a stock
  request → row created) succeeded end to end
- ⚠️ **Never opened inside an actual Telegram client.** Every check above hit
  `/api/v1/miniapp/*` directly with a hand-forged `initData` string signed against a test
  bot token — it proves the HMAC check, the linking logic, and the row scoping are
  correct, but not that `window.Telegram.WebApp` behaves as `miniapp.js` assumes in a real
  webview, that a genuine Telegram-issued `initData` (which carries more fields than my
  test payload) verifies the same way, or that the nine screens are usable on an actual
  phone. Needs a real bot with `TELEGRAM_MINIAPP_URL` pointed at `/miniapp` over HTTPS,
  opened via a menu button or inline URL button from a real Telegram account.

## Part 1 §2.10 — Auth & accounts

- ✅ No public sign-up: `/auth/email/register`, `/auth/email/confirm`, social login modules
  all removed from the codebase, not just hidden
- ✅ Admin creates users via two modes on one form — verified both: invite (no password
  stored, 7-day token) and set-password-now (`must_change_password=true`, zero tokens)
- ✅ Admin can set a new password from the edit form, or trigger a reset email instead
- ✅ Setting a password directly: `must_change_password` set, prompts at next sign-in
  (verified: redirects to `/set-password` before any other route), invalidates pending
  invite, kills sessions, activity-logged with the acting admin
- ✅ Invite tokens 7 days / reset tokens 1 hour, single-use, one `auth_tokens` table with
  `purpose`
- ✅ Pending-invite badge + Resend/Revoke — verified: resend rotates the token (old one
  stops working, exactly one row remains), revoke removes it and flips the badge
- ✅ No-password sign-in attempt → "invite is still pending" + resend offer, never treated
  as any-password
- ✅ Expired/used invite link → explanation page + "request a new one", not a raw error
  (verified both `expired` and `used` states render distinct copy)
- ✅ Exactly four public pages: sign in, forgot password, reset password, set password
- ✅ Sign in redirects to the originally requested URL after success
- ✅ Every other route requires a session; unauthenticated → `/login?next=...`
- ✅ Profile: name/department (read-only name, editable department), password change,
  Telegram link/unlink, payment destination (link + QR)
- ✅ Forgot-password renders an identical response for a known vs unknown email (verified:
  byte-for-byte identical via md5 comparison)
- ✅ Sign-in failure says "email or password is incorrect", never which
- ✅ Reset tokens single-use, short expiry; completing a reset kills other sessions
- ⚠️ Rate-limiting: `@nestjs/throttler` applied to sign-in and forgot-password (10/min);
  not load-tested
- ✅ `active=false` cannot sign in; deactivating kills sessions (verified live)
- ✅ CSRF on the auth forms too (verified: POST without a token → 403 on `/login`)

## Part 1 §2.11 — Admin

- ✅ Users: create (name, email, role, invite-or-password), update (name, email, role,
  active, telegram_id, optional new password), resend invite, revoke, delete
- ✅ Organization: departments and projects — create, rename, toggle active, delete
  (in-use rows correctly refuse deletion)
- ✅ Settings page: C2 approval thresholds (three explicit states — unlimited / a ceiling /
  no row — after a bug fix), C3 tolerances (verified the *trigger* actually reads a changed
  tolerance, not just the UI), integrations status panel

## Part 1 §2.12 — Files (Cloudflare R2)

- ✅ Presigned PUT for direct upload (server never streams the file) — code path verified
  against `storage.controller.ts`'s contract; `isConfigured` gate disables the upload UI
  cleanly when no credentials are set
- ✅ Presigned GET for viewing (short TTL)
- ✅ Only `object_key` persisted, never a URL
- ⚠️ Used for payment receipts, claim receipts, profile QR — wired into all three forms;
  never exercised against a real R2 bucket (no credentials in this environment)
- ✅ `requestChecksumCalculation: "WHEN_REQUIRED"` set, per the brief's explicit warning

## Part 1 §2.13 — Cross-cutting

- ✅ Money: `numeric(18,4)` everywhere, `numericTransformer`, never a JS float or TypeORM
  `float`/`number` — grepped, no violations
- ✅ `exchange_rate` = units per 1 USD; `amount_usd` rounded 4dp, displayed 2dp
  (`MoneyService` on decimal.js)
- ✅ Single money module, used by every controller that touches currency
- ✅ CSV export helpers — shared `csv.ts`, now on **every** list page (claims and
  stock-requests were missing it; added and verified in this pass)
- ✅ Theme (light/dark, persisted via localStorage + `prefers-color-scheme`), responsive
  shell (sidebar + Flowbite Drawer under `sm`, top bar, mobile nav)

## Part 1b — Procurement corrections

- ✅ **C1** — categories carry `expense_account_id`; PO resolution (`resolveExpenseAccountId`)
  picks the shared category's account or falls back to 6900; standalone payments require an
  explicit account; T5 resolves `coalesce(po, payment, 6900)`; acceptance test passed
- ⚠️ **C2 — amount tier kept, self-approval block deliberately removed.** On the user's
  explicit instruction (2026-08-07), manager/admin may now approve or reject their own PR —
  a departure from the brief. Trigger T6 dropped via migration
  `1785888300000-AllowPrSelfApproval`; service no longer throws on it. `approval_thresholds`
  (manager $1,000 / admin unlimited, editable under Admin → Settings, three-state UI) is
  unaffected and still enforced. Self-approvals are flagged `selfApproved: true` in the
  activity log, per the brief's own condition for an explicit, logged escape hatch —
  verified live: a manager approved their own PR, the row shows `selfApproved: true`
- ✅ **C3** — over-receipt (T3) and over-payment (T5) guards, both DB triggers, both also
  checked at submission for a clean form error; tolerances read from `app_settings`
  (verified live: raising the tolerance to 50% let a 5-of-4 claim through, resetting to 0
  refused it — the trigger reads the setting, confirmed, not just the app)
- ✅ **C4** — `suppliers` table with full CRUD under Admin, `supplier_id` FK + legacy
  `supplier` text kept for backfill, create-on-the-fly from the PO form (verified: typing a
  new name created a supplier row), spend-by-supplier report
- 📋 **C5** — **your decision, already made**: cash-basis (a). Recorded in AGENTS.md. Payment
  posts DR expense / CR 1000; nothing posts to 2000 A/P; verified via the journal lines on
  every test payment.

## Part 1c — UI plan

- ✅ Layout: persistent sidebar, Flowbite Drawer under `md`, top bar with title + primary
  action + user menu, max-width container, breadcrumbs on detail pages
- ✅ Density: compact tables, `tabular-nums`, money shows currency + USD alongside for
  non-USD records, secondary detail in muted text not extra rows
- ✅ List page anatomy: filter toolbar → count → sortable table → pagination → CSV, on
  every list page (gap closed in this pass — see Part 1 §2.13)
- ✅ Empty state defined once as `partials/empty-state`, reused everywhere — grepped, no
  page hand-rolls its own
- ✅ Detail page anatomy: header (number, status badge, actions) → summary card → line
  items → activity timeline last, on every detail page
- ✅ Forms: single column, labels above, errors inline, required marked, sticky footer on
  PR/PO/payment forms
- ✅ One status colour map (`partials/status-badge`) used for every domain-object status
  (PR/PO/claim/stock/priority states). The one exception, found on re-check: the admin
  users list hand-codes amber/red for "Pending invite" / "No password set" — account
  states outside the brief's status enum, with labels the shared partial can't express, so
  left as a deliberate one-off rather than forced through it
- ✅ Auth pages: centred card, no sidebar/top bar, correct `autocomplete`, `type="email"`,
  autofocus, show/hide password toggle, password rule shown before submission, alerts
  above the form, disabled+pending submit button, mobile-first
- ✅ No sign-up / no social login links anywhere (grepped templates)
- ✅ Create-user toggle defaults to "Send invite email", reveals the password field only in
  the other mode, only one mode's fields submit
- ✅ Dark mode via `dark:` + one persisted toggle; accessibility: visible focus rings
  (`:focus-visible` in `app.css`), `aria-current` on active nav, real `<label>`s throughout
- ✅ Recommended stack followed exactly: EJS + express-ejs-layouts, Tailwind CLI, Flowbite
  (vendored, pinned 4.0.2), Alpine (line-item repeaters, running totals, conditional
  fields), plain POST-redirect-GET, Chart.js vendored, inline SVG icons — no bundler,
  no CDN
- ✅ Markup sourced from `docs/flowbite-llms-full.txt` throughout, never written from memory
  (spot-checked sidebar/drawer/timeline/stepper/alert/toast/dropdown against the file
  during phase 2)
- ⚠️ Flowbite MCP theme generation — the MCP server is installed and connected
  (`claude mcp list` shows ✔), but the theme-file generation tool was never actually
  invoked; the navy palette was hand-authored into `tailwind.config.js` instead. Functionally
  equivalent, but the brief's specific workflow step wasn't exercised.
- ✅ File upload: presigned-PUT ported as `public/js/r2-upload.js`, hidden object-key input
  pattern used on all three upload forms
- ✅ Validation round-trip: `validateForm()` + POST re-render with submitted values —
  verified a multi-line PR keeps every typed line, the note, and the currency after a
  validation failure
- ✅ CSRF on every state-changing form (webhook is the one documented, deliberate exception)
- ⏸️ Optimistic UI / skeletons / client-side transitions — explicitly not worth preserving
  per the brief; none built

## Part 2 — Schema and invariants

- ✅ All 13 enums (module-appropriate: `user_role` was intentionally not created — see
  AGENTS.md "Roles" decision)
- ✅ Every table from Part 2.2–2.6, with the documented PK deviation (integer, not uuid)
- ✅ `auth_tokens` single-use store with `purpose`
- ✅ **T1** — USD derivation trigger, rate-≤0 rejected (verified)
- ✅ **T2** — deferred balance constraint on `journal_lines` (verified: unbalanced insert
  rejected at commit, not before)
- ✅ **T3** — claim confirmation: over-receipt guard, stock increment, ledger row, PO line
  advance, PO status recompute (all verified live)
- ✅ **T4** — stock fulfilment: lock, negative-stock guard, decrement, ledger row,
  auto-reorder PR + notifications (all verified live)
- ✅ **T5** — payment: over-payment guard, C1 account resolution, journal entry + balanced
  lines, payment-status rollup (all verified live, cash-basis per C5)
- ✅ **T6** — self-approval block at the DB layer (verified independently of the service
  check)
- ✅ `set_updated_at()` on every table with the column
- ✅ DTO validation rules from Part 2.8 — spot-checked PR/PO/payment/claim/stock/item/user
  DTOs against the listed rules; numeric coercion via `@Type(() => Number)` throughout

## Part 3 — Agent instructions

- ✅ Target architecture followed: module-per-slice, `*.controller.ts` / `*.api.controller.ts`
  split (Mini App), services, entities, DTOs
- ✅ TypeORM entities + migrations, triggers as raw SQL, money as numeric+transformer
- ✅ Flowbite as the one component library, Alpine only where Flowbite has no equivalent,
  Chart.js for the three dashboard charts, no React/SPA/bundler
- ✅ Auth built on the boilerplate's JWT+session base, disabled public registration exactly
  as instructed
- ✅ Authorization built as both layers per the explicit instruction (guard + row scoping)
- ✅ Database: entities, migrations, triggers T1–T6, seeds (chart of accounts, 4 categories
  with expense accounts, approval thresholds, one user per role) — verified via a full
  `db:reset` cycle (schema:drop → migrate → seed) from empty, twice
- ✅ Infrastructure: MoneyService, RatesService + cron, R2 files, ActivityService,
  Telegram/NotificationsService, Mini App, OCR — all built; storage/Telegram/OCR flagged
  ⚠️ above for "never hit the real third party"
- ✅ Phase order followed exactly (schema → auth/shell → procurement → inventory/stock →
  accounting/reports/dashboard → Telegram/Mini App → Admin/profile), stopping for review
  after each

## Part 4 — Open decisions

1. Triggers vs services — **kept as triggers**, per the brief's own recommendation
2. UI — Flowbite chosen and built out; see Part 1c above
3. **Data migration — not done.** No old Supabase database was available or referenced;
   nothing to migrate in this environment
4. **C5 — settled: cash-basis**, recorded in AGENTS.md
5. **Transactional email — not configured.** Templates exist (`invite.hbs`,
   `password-reset.hbs`, plus the boilerplate's originals); SMTP still points at
   `localhost:1025`. Needed before real invites can be sent.
6. Environment/config — done as a single pass; every new integration (R2, Telegram, OCR,
   rates) has its own `*.config.ts` + `env-example-relational` entries
7. **Tests — not written.** This build was verified by exercising the running app end to
   end for every phase rather than by an automated suite. No decision has been made on
   whether to add one now.

---

## What's real work left, not process

Everything above that isn't ✅ or ⏸️ is either your call (📋) or needs a live third-party
credential to finish verifying (⚠️). Nothing on this list is unbuilt due to missing code —
the two actual gaps this checklist pass found (CSV export missing on the claims and
stock-requests list pages) have been fixed and re-verified above.

To close the ⚠️ items for real, in the order they'd normally come up:
1. Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` + the two group/topic ids, expose
   `BACKEND_DOMAIN` publicly, run `POST /telegram/setup`, send a real PR and watch the group.
2. Set the R2 credentials (`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `AWS_DEFAULT_S3_BUCKET`,
   `R2_ENDPOINT`), upload a real receipt, confirm the presigned GET renders it back.
3. Set `OCR_SPACE_API_KEY`, upload a real receipt photo, confirm autofill.
4. Pick an SMTP provider, set `MAIL_*`, send a real invite end to end.
5. Run the Flowbite MCP's theme-generation tool once, compare its output against the
   hand-authored `tailwind.config.js` palette, and decide whether to swap.
