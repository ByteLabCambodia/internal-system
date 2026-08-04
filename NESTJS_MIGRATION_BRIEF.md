# Operations system — build specification

*NestJS + EJS + Postgres (TypeORM), on `brocoders/nestjs-boilerplate`.*

**This document is self-contained.** It is the complete specification for the new system —
the agent needs no access to the old repository and no other file. Paste the whole thing
into Claude Code in your `brocoders/nestjs-boilerplate` project (or keep it in that repo
under any name and say "build this").

- **Part 1 — Feature specification**: everything the system must do.
- **Part 1b — Procurement corrections** (C1–C5): where the old design was wrong and what to build instead.
- **Part 1c — UI plan** (EJS + Flowbite), component by component.
- **Part 2 — Schema and invariants**: complete DDL and the trigger logic, ready to port to TypeORM migrations.
- **Part 3 — Instructions for the agent**: the actual task, architecture rules, and phase plan.

Descriptions of "today" / "the legacy app" are background for *why* a rule exists. They are
not an instruction to go and read anything — everything needed to build is written out here.

---

# Part 1 — Feature specification

## 1. Roles & permission matrix

Roles: `employee`, `manager`, `finance`, `admin`.

| Permission | employee | manager | finance | admin |
|---|:--:|:--:|:--:|:--:|
| `pr.create` | ✅ | ✅ | ✅ | ✅ |
| `pr.decide` (approve/reject) | | ✅ | | ✅ |
| `pr.cancel` | | ✅ | ✅ | ✅ |
| `po.create` | | ✅ | ✅ | ✅ |
| `po.cancel` | | ✅ | ✅ | ✅ |
| `payment.record` | | | ✅ | ✅ |
| `claim.submit` | ✅ | ✅ | ✅ | ✅ |
| `claim.confirm` | | ✅ | | ✅ |
| `stock.request` | ✅ | ✅ | ✅ | ✅ |
| `stock.fulfil` | | ✅ | | ✅ |
| `inventory.manage` | | ✅ | | ✅ |
| `accounting.view` | | ✅ | ✅ | ✅ |
| `income.add` | | | ✅ | ✅ |
| `rate.override` | | | ✅ | ✅ |
| `users.manage` | | | | ✅ |

The previous system enforced this twice: in Postgres row-level security and in the app. There is no RLS here, so **both layers become guards + row-scoping in services** (see Part 3).

Row visibility rules — implement as query scoping:
- Purchase requests / stock requests / claims: own rows, or any row if manager/finance/admin.
- Purchase orders: own created rows, or any if manager/finance/admin.
- Payments, accounts, journal entries/lines, budgets: manager/finance/admin read; finance/admin write.
- Inventory items, categories, exchange rates: everyone reads; manager/admin (rates: finance/admin) writes.
- Notifications: own only.
- Stock movements: read-only for all; written only by triggers/RPC.

## 2. Domain modules

### 2.1 Procurement
- **Purchase Requests (PR)** — `PR-0001` sequential number; statuses `draft → pending → approved | rejected | cancelled → converted`; multi-line items (name, qty, unit price, optional inventory item link, category); currency USD/KHR/CNY with FX rate **locked at submit**; department/project dimensions; note; requester, approver, decided_at; `auto_generated` flag for reorder PRs; Telegram message/chat id for the approval message.
- **Purchase Orders (PO)** — `PO-0001` sequential; created from an approved PR (PR flips to `converted`); type `online | physical`; supplier; currency + locked rate; status `open → partial → complete | cancelled`; payment status `unpaid → partial → paid`; line items with `qty_ordered` / `qty_claimed`.
- **Payments** — recorded against a PO (or standalone direct expense); amount + currency + locked rate → `amount_usd`; `paid_at`; method (`bank_transfer|cash|card|mobile|other`); bank_account, reference, trx_id, sender, transfer_to, remark; receipt image object key; auto-creates a balanced journal entry and rolls up PO payment status.
- **Receipt OCR** — upload a receipt image, call OCR.space (engine 2, table mode), auto-fill amount, currency, reference, trx id, sender, transfer-to, remark, bank account, paid_at.
- **Payment destination on profile** — each user stores a payment link and/or QR image once; surfaced in PR/PO detail so finance can pay the requester.
- **Unified flow stepper** — Requested → Approved → Ordered → Paid → Received, derived from PR/PO status.
- **Cancel** flows for PR and PO.

### 2.2 Inventory
- **Catalog items** — sku (unique), name, category, unit, `stock_qty`, `reorder_point`, `reorder_qty`, active flag.
- **Categories** — managed list (name unique, description), seeded with Electronics / Office Supplies / Tools / Materials.
- **Claims** — an employee claims goods received against a PO line; status `pending → confirmed | rejected`. On confirm: stock increments, a stock movement is appended, the PO line's `qty_claimed` increases, and the PO status recomputes to `partial`/`complete`.
- **Manual stock adjustment** — manager/admin only; delta ± with note; guards against negative stock; appends an `adjustment` movement.
- **Stock movements ledger** — append-only, with `delta`, `reason` (`claim|stock_request|adjustment`), ref table/id, `balance_after`, actor.
- **Item detail page** — item info, current stock, movement history.

### 2.3 Stock requests
- Employee requests qty of an item; priority `low|medium|high|urgent`; department; note.
- Status `pending → approved → fulfilled | rejected`.
- On fulfil: stock decrements (fails if insufficient), movement appended.
- **Auto-reorder**: if resulting balance ≤ reorder point and `reorder_qty > 0`, a draft `auto_generated` PR is created with one line for `reorder_qty`, and `stock_below_reorder` notifications are inserted for all active managers/admins.

### 2.4 Accounting
- **Chart of accounts** — seeded: 1000 Cash/Bank (asset), 2000 A/P (liability), 3000 Owner Equity, 4000 Sales/Service Income, 6000 Office Supplies Expense, 6100 IT/Components Expense, 6900 Misc Expense.
- **Journal entries + lines** — double entry in USD; a line is one-sided (debit XOR credit, non-negative); each entry must balance (deferred constraint check); dimensions: department, project; `source` = `po_payment | manual_income | manual`, plus `source_ref`.
- **Manual income** — finance/admin records income → balanced entry (DR Cash / CR chosen income account).
- **Exchange rates** — one row per (date, currency), `rate_to_usd` = units per 1 USD; source `api | manual`; finance/admin can override; daily cron fetch; `getCurrentRate()` returns the most recent rate on/before today (USD = 1).
- **Budgets** — per department/project/category/month, `amount_usd`; powers Budget vs Actual.

### 2.5 Reports (with date-range filter + CSV export)
1. Profit & Loss by month (income vs expense vs net)
2. Cash flow by month (inflow/outflow/net through account 1000)
3. Expense by category (expense account name)
4. Expense by department
5. Currency summary (original + USD totals and count, by currency)
6. PO summary (status, payment status, totals)
7. Transaction history
8. Budget vs actual

All figures use the **per-record locked rate stored on the journal line**, never today's rate.

### 2.6 Dashboard
- KPI cards: my pending requests, low-stock items, open purchase orders; plus (for accounting-view roles) this month's expense and cash balance.
- Charts: P&L, expense by category, expense by department.
- Activity feed (recent POs, payments, claims, stock requests).
- Notifications panel: low stock + pending approvals.

### 2.7 Activity timeline (audit log)
`activity_events` (entity_type, entity_id, action, actor, jsonb detail, created_at) rendered as a timeline on PR / PO / payment / stock request detail pages. Written best-effort from every state-changing action (`created`, `submitted`, `approved`, `rejected`, `converted`, `cancelled`, `payment_recorded`, `fulfilled`). Never rolls back the business mutation.

### 2.8 Telegram integration
- **Bot notifications** via a single `notify(event, payload)` abstraction — business logic never calls the Bot API directly. Events: `pr_created`, `pr_decided`, `po_created`, `payment_recorded`, `claim_submitted`, `claim_confirmed`, `stock_request_submitted`, `stock_below_reorder`, `exchange_rate_updated`.
- **Routing**: PR created & claim submitted → manager group (forum topic); PO created → finance group topic; payment recorded → manager DMs; PR decided / claim confirmed → requester DM; rate updated → finance DMs. Every send also writes an in-app `notifications` row; all sends are best-effort (never throw).
- **Inline keyboard actions** — Approve/Reject a PR, Confirm/Reject a claim, Fulfil/Reject a stock request directly from Telegram; the presser's telegram_id maps to a profile and their role is checked before applying.
- **Webhook hardening** — secret-token header check + `telegram_updates` idempotency table keyed on `update_id`.
- **Account linking** — one-time link token on the profile with expiry, plus a credentials-based link endpoint; unlink from profile page.
- **Webhook setup** endpoint.

### 2.9 Telegram Mini App
Separate mobile shell authenticated by **initData HMAC**, not cookies. Screens: link account, home, PR form, stock request form, claim form, submitted confirmation, history (list + PR/claim/stock detail). Backed by its own API surface: `data` (profile, items, PO options, rates), `pr`, `stock`, `claim`, `history`, `history/pr/:id`, `history/claim/:id`, `history/stock/:id`, `notify`.

### 2.10 Auth & accounts
- **There is no public sign-up.** This is an internal system: accounts are created by an
  admin under Admin → Users. The boilerplate ships public email registration, email
  confirmation and social login (Google/Facebook/Apple) — **leave all of that disabled and
  do not expose routes for it.** Enabling self-registration would let anyone create an
  account inside the company's procurement system.
- **Creating a user — the admin picks one of two modes on the same form:**
  - **Send invite** (the default). The system emails a single-use set-password link; the
    user sets their own password, and is signed in and redirected to the dashboard. The
    admin never handles a password.
  - **Set password now.** The admin types an initial password and passes it to the user
    out of band. Useful when email is slow, the user is standing next to them, or a
    contractor has no working inbox yet.
  - An admin can also set a new password for an existing user from the edit form, and can
    still trigger a reset email instead.
  - When a password is set directly: mark the account `must_change_password`, prompt for a
    new password at the user's next sign-in before letting them into the app, invalidate
    any pending invite token, kill that user's existing sessions, and write an
    `activity_events` row recording which admin did it.
  - Invite tokens last **7 days**; password-reset tokens last **1 hour**. Both are
    single-use. Use one token mechanism with a `purpose` of `invite | reset` — the only
    differences are the expiry and the email template.
  - Admin → Users shows a **Pending invite** badge for users who have not set a password
    yet, with **Resend invite** and **Revoke** actions. Resending issues a new token and
    invalidates the previous one.
  - A user with no password set cannot sign in; the attempt says their invite is still
    pending and offers to resend it. Never treat "no password" as "any password".
  - An expired or already-used invite link lands on a page that explains this and offers
    to request a new one — not a raw error.
- Public auth surface is exactly four pages: **sign in**, **forgot password**,
  **reset password** (token link from email), and **set password** (the invite landing).
- Sign in is email + password. Redirect to the originally requested URL after success.
- Every other route requires a session; unauthenticated requests redirect to `/login`.
- **Profile page**: name, department, password change, Telegram link/unlink, payment destination (link + QR upload).

Auth security rules, all of which must hold:
- Forgot-password always renders the same confirmation, whether or not the email exists —
  never reveal which addresses are registered. Sign-in failures say "email or password is
  incorrect", never which one was wrong.
- Reset tokens are single-use with a short expiry, and completing a reset invalidates the
  user's other sessions.
- Rate-limit sign-in and forgot-password per IP and per account.
- An `active = false` user cannot sign in, and deactivating a user kills their sessions.
- CSRF tokens on the auth forms too, not just the app forms.

### 2.11 Admin
- **Users**: create (name, email, role, and either "send invite" or an initial password), update (name, email, role, active, telegram_id, optional new password), resend invite, revoke pending invite, send reset email, delete.
- **Organization**: departments and projects — create, rename, toggle active, delete.
- **Settings** page.

### 2.12 Files (Cloudflare R2, S3-compatible)
Presigned PUT for direct browser upload (server never streams the file), presigned GET / public URL for viewing; only the `object_key` is persisted. Used for payment receipts, claim receipts, profile payment QR.

### 2.13 Cross-cutting
- **Money**: `numeric(18,4)`, never floats. `exchange_rate` = units per 1 USD. `amount_usd = amount_original / exchange_rate` rounded to 4dp, displayed at 2dp. Single money module.
- **CSV export** helpers.
- **Theme** (light/dark), responsive shell: sidebar + header + mobile nav.

## 3. Data model

See **Part 2** for the complete DDL — tables, enums, sequences, indexes, checks — and the
six database-enforced invariants (T1–T6).

---

# Part 1b — Procurement corrections

The legacy flow's shape (requisition → approval → PO → receipt → payment) is standard.
These are the places it deviates, to be fixed as part of the port rather than reproduced
faithfully. Each one is cheap now and expensive after the new system has live data.

## C1. Expense category → GL account mapping  *(required)*

**Today:** `on_payment_insert` hardcodes account `6100` (IT/Components Expense), so every
payment ever made lands in one account and the "Expense by category" report returns a
single row. The `category` collected on PR items and inventory items never reaches the GL.

**Fix:**
- `categories` gains `expense_account_id uuid references accounts(id)`. Seed the four
  default categories to sensible accounts (Electronics/Tools/Materials → 6100,
  Office Supplies → 6000).
- `purchase_orders` gains `expense_account_id uuid references accounts(id)`, resolved at
  PO creation: if every line shares one category, use that category's account; otherwise
  fall back to `6900` Misc Expense. Finance can override it on the PO form.
- Standalone payments (no PO) require an explicit expense account on the payment form.
- `on_payment_insert` debits `coalesce(po.expense_account_id, payment.expense_account_id, '6900')`
  instead of the hardcoded `6100`.
- `expenseByCategory` keeps grouping by account name — it starts returning real data.

*(Optional refinement, not required: split the debit across multiple expense accounts
prorated by line value. More accurate, but the trigger then has to guarantee the debit
lines sum exactly to `amount_usd` after rounding. Single-account-per-PO is the safe default.)*

## C2. Segregation of duties on PR approval  *(required)*

**Today:** `decidePurchaseRequest` and `guard_pr_decision` check only that the actor is a
manager/admin. A manager can raise and approve their own PR, and a $5 request needs the
same single signature as a $50,000 one.

**Fix:**
- **Self-approval blocked**: `approver_id <> requester_id` enforced in the service *and* as
  a DB trigger (this check needs no `auth.uid()`, so it survives the move off Supabase).
  Admins are not exempt — if you want an escape hatch, make it explicit and logged.
- **Amount tiers**: new table
  `approval_thresholds(id, role user_role, max_amount_usd numeric(18,4) null, active bool)`,
  seeded `manager → 1000.00`, `admin → null` (unlimited). Approval is rejected when the PR's
  `total_usd` exceeds the approver's role limit, with the message naming the role required.
  Admin UI to edit the thresholds lives under Admin → Settings.
- The `pr.decide` permission still gates *who may attempt* a decision; the threshold gates
  *which decisions succeed*.

## C3. Over-receipt and over-payment guards  *(required)*

**Today:** `on_claim_confirmed` adds to `qty_claimed` without comparing to `qty_ordered`, so
a PO line can be received 3× over. `on_payment_insert`'s `CASE` caps the *status* at `paid`
but accepts unlimited payments against the same PO.

**Fix — both as DB triggers, both raising before the mutation:**
- Claim confirm: raise when `qty_claimed + new.qty_claimed > qty_ordered`. Validate the same
  rule at claim submission too, so the user gets a clean form error rather than a 500.
- Payment insert: raise when `sum(existing amount_usd) + new.amount_usd > po.total_usd`.
  Compare in **USD**, since payments may be in a different currency from the PO.
- Both take a tolerance from config (`RECEIPT_TOLERANCE_PCT`, `PAYMENT_TOLERANCE_PCT`),
  defaulting to `0`. Real purchasing sometimes needs 2–5%; make it a setting, not a hardcode.

## C4. Supplier master  *(required)*

**Today:** `purchase_orders.supplier` is free text. "ABC Co." and "ABC Co" are two vendors
forever, and there is no spend-per-supplier view.

**Fix:**
- New table `suppliers(id, name unique, contact_name, phone, email, address, bank_account,
  payment_terms_days int, note, active, created_at, updated_at)` with CRUD under Admin
  (permission: `suppliers.manage` → manager/finance/admin).
- `purchase_orders` gains `supplier_id uuid references suppliers(id)`; keep the legacy
  `supplier` text column for backfill, and on data import create one supplier row per
  distinct trimmed name.
- PO form uses an autocomplete over active suppliers with create-on-the-fly.
- New report: **spend by supplier** (count of POs, total USD, last order date), added to the
  existing report set and CSV export.

## C5. Accounts Payable / accrual accounting  *(DECISION REQUIRED — do not guess)*

Account `2000` Accounts Payable is seeded but nothing ever posts to it. The system is
effectively **cash-basis**: expense is recognized when paid, not when received.

Two models — pick one before phase 5, with whoever owns the books:

- **(a) Keep cash-basis** (current behavior + C1's account fix). Payment posts
  `DR Expense / CR Cash`. Simple, matches what a small operation actually tracks. No A/P
  aging, and expense lands in the month of payment.
- **(b) Move to accrual.** Two entries: on claim confirmation (goods receipt)
  `DR Expense / CR A/P`, and on payment `DR A/P / CR Cash`. Gains a real "what we owe
  suppliers" figure, AP aging by `payment_terms_days`, and expense in the correct period.
  Costs: a new trigger on claim confirm, `on_payment_insert` rewritten to debit A/P, and
  every report that assumes expense == payment revisited.

**Default if nobody decides: (a).** Whichever is chosen, write it down in the new repo's
`AGENTS.md` — it is the single assumption the entire reporting layer rests on.

## Explicitly deferred (not in this migration)

- **Supplier invoices + 3-way match** (PO ↔ receipt ↔ invoice before payment release). Only
  worth it if suppliers actually invoice you on terms rather than being paid on the spot.
- **Budget enforcement.** `budgets` is written by nothing today — the table is read by one
  report and has no admin UI. Minimum viable follow-up: budget CRUD under Admin, plus an
  availability check at PR approval. Not required for feature parity, since the current
  system has no working budget feature to preserve.
- **Inventory valuation / COGS.** Stock has quantity but no cost anywhere, so there is no
  inventory asset on the balance sheet. Fine for consumables; revisit if you start holding
  material stock of real value.

---

# Part 1c — UI plan (EJS + Flowbite)

This is the largest chunk of hand work. The tables below size it using the previous React
implementation (~9,300 LOC of client components) — they are here to tell you what each
screen has to do and how much of it is real work, not as a pointer to code to read.

**Do not install** `@dnd-kit/*`, `@tanstack/react-table`, `@tanstack/react-virtual` or
`react-day-picker`. They were dependencies of the old app but imported by nothing: there is
no drag-and-drop and no data grid in this system, and every date field is a plain date input.

## Design direction

This is an **internal operations tool**, not a marketing dashboard. Finance and procurement
staff use it many times a day on desktop; employees mostly use the Telegram Mini App. Design
for scanning, repeat use, and information density — not for first impressions.

Concretely, "modern admin dashboard" here means:

**Layout.** Persistent left sidebar (Dashboard, Purchase Requests, Purchase Orders, Claims,
Stock Requests, Inventory, Reports, Accounting, Admin), collapsing to a Flowbite Drawer under
`md`. Top bar carries the page title, the page's single primary action, and the user menu.
Content in a max-width container; breadcrumbs on detail pages.

**Density.** Compact tables — one row per record, never two. Numbers right-aligned with
`tabular-nums`. Money always shows its currency, and USD alongside when the record is in KHR
or CNY. Secondary detail goes in muted text within the cell, not in extra rows or nested tables.

**Every list page gets the same anatomy**, in this order: filter toolbar (status, date range,
free-text search) → count → table with query-param sorting → pagination → CSV export button.
Define the empty state once as a partial and reuse it; a blank table with no explanation is
the most common way these pages go wrong.

**Every detail page gets the same anatomy**: header (record number, status badge, actions),
summary card, line items table, then the activity timeline last.

**Forms.** Single column, labels above inputs, errors inline under the field, required marked.
Long forms (PR, PO, payment) get a sticky footer with the primary and cancel actions.

**One status colour map, applied everywhere** — no page invents its own:

| Colour | Statuses |
|---|---|
| grey | `draft`, `cancelled`, priority `low` |
| amber | `pending`, `partial`, priority `medium` |
| blue | `approved`, `open` |
| indigo | `converted` |
| green | `complete`, `paid`, `confirmed`, `fulfilled` |
| red | `rejected`, `unpaid`, priority `urgent` |
| orange | priority `high` |

Build this as one `status-badge` EJS partial taking a status string; never hand-pick colours
at the call site.

**Auth pages** (sign in, forgot password, reset password, set password) sit outside the app
shell and get their own minimal layout — no sidebar, no top bar. One centred card on a plain
background, max ~400px: logo, page title, one-line explanation, the fields, one full-width
primary button, and one text link out (sign in ⇄ forgot password). Use Flowbite's form and
card components, the same theme and dark mode as the app.

Details that matter more on these four pages than anywhere else:
- Correct `autocomplete` attributes (`username`, `current-password`, `new-password`) so
  password managers work, `type="email"` for the right mobile keyboard, and autofocus on the
  first field.
- A show/hide toggle on password fields, and the password rule stated *before* submission,
  not only as an error afterwards.
- Errors render above the form as a Flowbite alert; success states (reset email sent,
  password changed) do the same in green and offer the obvious next link.
- The submit button disables and shows a pending label on submit, so a slow POST does not
  produce three password-reset emails.
- These pages must look finished on a phone — employees hit them from Telegram links.

There is **no sign-up page and no social login button** — see Part 1 §2.10. Do not add
"Create an account" links.

The admin's **create user** form carries the invite-vs-password choice: a two-option toggle
defaulting to "Send invite email", where choosing "Set password now" reveals the password
field. Only one of the two is ever submitted. Users awaiting an invite show a **Pending
invite** badge in the user list, and a user flagged `must_change_password` is routed to the
set-password page on sign-in before reaching any other route.

**Dark mode** via Flowbite's `dark:` variants and one toggle, persisted. **Accessibility**:
visible focus rings, `aria-current` on the active nav item, real `<label>`s, and contrast
that survives both themes.

**What "modern" does not mean here:** no hero sections, no decorative gradients or
animations, no skeleton loaders, no client-side page transitions. A fast server-rendered page
is the aesthetic. If a choice trades scannability for polish, choose scannability.

## Recommended stack for the EJS layer

| Concern | Choice | Why |
|---|---|---|
| Templating | EJS + `express-ejs-layouts`, partials per component | boilerplate is Express-based |
| CSS | Tailwind CLI → `public/css/app.css` | no PostCSS-in-Next dance |
| **Component library** | **Flowbite** (Tailwind plugin + `flowbite.js`, vendored locally) | see below — one library, chosen deliberately |
| Local interactivity | **Alpine.js**, only for what Flowbite doesn't cover | the PR/PO line-item repeater, running totals, conditional fields |
| Server interactivity | Plain POST → redirect → flash. htmx only if a page genuinely needs partial updates | forms here are all coarse-grained; htmx would be ceremony |
| Charts | **Chart.js vendored locally** (3 charts, dashboard only) | recharts is React-only; server-rendered SVG is harder to make responsive |
| Icons | Inline SVG partials | replaces `lucide-react` |

No bundler is required. Flowbite + Alpine + Chart.js as three `<script>` tags from
`public/js`, alongside the Tailwind CLI watch, is the entire front-end build.

## Why Flowbite, and what it costs

**Pick one library and take its whole design language.** Mixing a component kit with
hand-rolled partials is how you end up with two visual systems and no consistency.

Flowbite wins on one criterion that matters more than taste here: it ships vanilla-JS
implementations of *specifically the components this app needs* — modal, dropdown, tabs,
drawer, toast, datepicker, file input, **stepper**, and **timeline**. The last two are the
awkward ones (485 and 214 LOC of vendored React today), and most kits don't have them.
Its JS is driven by `data-*` attributes rather than an init call per component, which
matters when your markup comes from server-rendered EJS partials — you write attributes,
not JavaScript. Core is MIT, it has a Tailwind plugin, and the docs are plain HTML you can
paste straight into a `.ejs` file.

**What it costs:** Flowbite has its own look. The current shadcn/reui visual identity —
the CSS-variable token system in `globals.css`, the specific radii and greys — does not
survive as-is. Since every view is being rewritten anyway, that's a reasonable trade, but it
is a real change and you should look at Flowbite's components before committing.

**The official Flowbite MCP server narrows that gap.** `npx -y flowbite-mcp` exposes two
tools: **theme-file generation** from brand colours + a UI description, and **Figma-to-code**
conversion (HTML/React/Svelte). Configure it in the new project and use the theme generator
to carry the current palette across, so you keep your colours and lose only Flowbite's
component anatomy rather than the whole identity. The Figma tool is useful only if you have
designs in Figma, and it is the only one needing `FIGMA_ACCESS_TOKEN`.

Note what the MCP is **not**: it is not a documentation/markup lookup server. It will not
hand the agent current Flowbite component markup.

**That job is done by Flowbite's `llms.txt` instead**, and it matters more here than the MCP
does. Flowbite publishes LLM-optimized docs per the llms.txt standard:

- concise index — `https://github.com/themesberg/flowbite/blob/main/llms.txt`
- **full** — `https://raw.githubusercontent.com/themesberg/flowbite/refs/heads/main/llms-full.txt`

The full file is plain HTML component markup with the `data-*` attributes and Tailwind
classes already applied — i.e. exactly what an EJS partial needs, in paste-ready form:

```html
<div id="accordion-collapse" data-accordion="collapse">
  <h2 id="accordion-collapse-heading-1">
    <button type="button" class="flex items-center justify-between w-full p-5 ..."
      data-accordion-target="#accordion-collapse-body-1" aria-expanded="true">
```

**How to use it:** vendor `llms-full.txt` into the new repo (e.g.
`docs/flowbite-llms-full.txt`), pinned to the same Flowbite version as the vendored JS/CSS,
and point the new project's `AGENTS.md` at it as the authoritative source for component
markup. It is large — grep it per component rather than reading it whole.

⚠️ **Use the vanilla `themesberg/flowbite` file, NOT `flowbite-react.com/llms.txt`.** The
latter is the React variant; feeding it to an agent building EJS templates is actively
harmful. Same trap applies to Flowbite's Svelte and React docs generally — when searching,
confirm you are on the plain-HTML docs.

So: **MCP for theming, `llms-full.txt` for markup.** They solve different halves, and the
second is the one that keeps hundreds of generated components consistent and correct.

**If visual continuity matters more than component coverage,** the alternative is
**Preline UI**: closer to the shadcn aesthetic, comparable component set including its own
stepper, timeline, advanced datepicker and searchable select. Slightly heavier JS API
(explicit init). Pick one or the other — not both, and not one plus hand-rolled equivalents.

**Rejected:** *daisyUI* (pure-CSS, zero JS, but no datepicker or combobox, and the most
distant look); *Tailwind Plus* (paid, and its HTML variants assume Alpine anyway);
building the kit by hand (you already know how that ends — 3,500 LOC of primitives).

Whichever is chosen, **vendor the CSS/JS into `public/`** rather than a CDN, and pin the
version.

## Primitive layer — mostly evaporates

These are vendored reui/shadcn components today. Most have a native HTML equivalent, so
they do not get "ported" so much as deleted:

| Legacy component | LOC | Used in | Replacement |
|---|---:|---|---|
| `reui/date-selector` + `reui/date-picker` + `ui/calendar` | ~1,570 | 3 places | `<input type="date">`, or Flowbite Datepicker where a range UI helps (reports filter) |
| `reui/stepper` | 485 | 1 (procurement stepper) | Flowbite Stepper |
| `reui/autocomplete` | 345 | 1 (PO supplier field) | `<input list>` + `<datalist>` |
| `reui/number-field` | 259 | 11 places | `<input type="number" step>` |
| `ui/select` | 215 | 12 places | native `<select>` with Flowbite styling |
| `ui/dropdown-menu` | 268 | 1 (user menu) | Flowbite Dropdown |
| `ui/table` | — | 12 places | Flowbite Table styles; sorting/filtering via query params |
| `reui/timeline` | 214 | 1 (activity timeline) | Flowbite Timeline |
| `ui/dialog` / `ui/sheet` / `ui/tabs` | — | 4 / 1 / 1 | Flowbite Modal / Drawer / Tabs |
| `reui/file-upload` | — | 3 places | Flowbite File Input for the markup + the ported R2 upload JS (below) |
| `reui/badge`, `ui/status-badge` | — | 6 places | Flowbite Badge + a status→colour EJS helper |
| `sonner` toasts | — | app-wide | Flowbite Toast, rendered from server flash messages |
| app shell / sidebar / mobile nav | — | app-wide | Flowbite Sidebar + Drawer |

## Feature components — the actual work

Ranked by effort. Sizes are relative, not estimates.

**Large**
- **Telegram Mini App** (~1,300 lines previously) — 9 screens with client-side navigation,
  three forms, and a history browser. **Do not build this as server-rendered page loads.**
  It is a Telegram webview talking to a JSON API; full page reloads feel wrong inside
  Telegram. Serve one EJS shell and write the screen logic as vanilla JS or Alpine against
  the `/api/miniapp/*` endpoints.
- **PR form** (271) and **PO form** (326) — dynamic multi-line item editors with running
  totals and currency conversion preview. Alpine `x-data` with an items array handles this
  well; server must accept array-style form fields (`items[0][name]`) and validate with a
  DTO carrying `@ValidateNested({ each: true })`.
- **Record payment form** (237) — file upload + OCR round-trip that autofills eight fields,
  plus method-dependent field visibility.

**Medium**
- **Profile form** (337) — password change, Telegram link/unlink, payment QR upload.
- **Users manager** (205) — inline create/edit/delete with role and active toggles.
- **Categories manager**, **org list** (departments/projects inline CRUD).
- **Dashboard charts** — three Chart.js instances fed by JSON embedded in the template.
- **Claim form**, **stock request form**, **item form**, **income form**, **rate form**,
  **adjust form** — straightforward single forms.

**Small**
- Decide/cancel/claim buttons (procurement, stock, claims) — POST forms with a confirm.
- Reports date filter, admin tabs, theme toggle, mobile nav, app shell, login /
  forgot-password / reset-password pages.

## Three things that genuinely change

1. **File upload.** The presigned-PUT flow (request URL → `PUT` straight to R2 → submit the
   object key) is inherently client-side and must stay JS. Port `lib/r2-upload.ts` as a
   plain-JS module in `public/js`, and have each form hold a hidden input for the object key.
   Keep the `requestChecksumCalculation: "WHEN_REQUIRED"` fix.
2. **Validation error round-trips.** Server actions today return an error object and React
   keeps the user's typed values. With POST-redirect-GET you must re-render the form with
   the submitted values *and* the field errors — via flash or by rendering the form directly
   on the POST response. Decide once, apply everywhere; getting this wrong means users
   retype whole multi-line PRs after one bad field.
3. **CSRF.** Server actions had it built in. Every state-changing form now needs a token.

## Explicitly not worth preserving

Optimistic UI, route-level loading skeletons, and client-side transitions. A server-rendered
page load is fast enough for this app, and reproducing them in EJS costs more than it returns.

---

# Part 2 — Schema and invariants

Complete target schema for the new system: the legacy schema with all 21 migrations folded
in, the Supabase-specific parts removed, and the C1–C4 corrections applied (marked `-- C1`
etc.). Write this as TypeORM entities + migrations. Money is `numeric(18,4)` everywhere;
`exchange_rate` is `numeric(18,6)` and means **units of currency per 1 USD**.

## 2.1 Enums

```sql
create extension if not exists pgcrypto;

create type currency              as enum ('USD','KHR','CNY');
create type user_role             as enum ('employee','manager','finance','admin');
create type pr_status             as enum ('draft','pending','approved','rejected','cancelled','converted');
create type po_type               as enum ('online','physical');
create type po_status             as enum ('open','partial','complete','cancelled');
create type payment_status        as enum ('unpaid','partial','paid');
create type claim_status          as enum ('pending','confirmed','rejected');
create type stock_request_status  as enum ('pending','approved','fulfilled','rejected');
create type stock_priority        as enum ('low','medium','high','urgent');
create type account_type          as enum ('asset','liability','equity','income','expense');
create type movement_reason       as enum ('claim','stock_request','adjustment');
create type journal_source        as enum ('po_payment','manual_income','manual');
create type rate_source           as enum ('api','manual');
create type payment_method        as enum ('bank_transfer','cash','card','mobile','other');
```

## 2.2 Identity & org

The legacy `profiles` table merges into the boilerplate's `User` entity. These are the
columns to add to it (there is no separate profiles table, and no `auth.users`):

```
role user_role not null default 'employee'
telegram_id bigint unique          telegram_username text
telegram_link_token text unique    telegram_link_expires_at timestamptz
department text                    active boolean not null default true
payment_link text                  payment_qr_object_key text
```
Partial index on `telegram_link_token where telegram_link_token is not null`.
The **password column must be nullable** — an invited user has none until they set one, and
"no password" must never authenticate. Add `must_change_password boolean not null default
false`, set when an admin sets a password directly and cleared once the user changes it.

Invites and password resets share one single-use token store, distinguished by `purpose`
(reuse the boilerplate's equivalent if it already ships one rather than adding a second):

```sql
create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,     -- store a hash, never the raw token
  purpose text not null,               -- 'invite' | 'reset'
  expires_at timestamptz not null,     -- invite: +7 days, reset: +1 hour
  used_at timestamptz,
  created_at timestamptz not null default now());
create index auth_tokens_user_idx on auth_tokens (user_id, purpose);
```
Everything below that references `profiles(id)` should reference the users table.

```sql
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null, active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table projects (  -- identical shape to departments
  id uuid primary key default gen_random_uuid(),
  name text not null, active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

-- C4: supplier master, replaces the free-text purchase_orders.supplier
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text, phone text, email text, address text,
  bank_account text, payment_terms_days int, note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

-- C2: amount tiers for PR approval
create table approval_thresholds (
  id uuid primary key default gen_random_uuid(),
  role user_role not null unique,
  max_amount_usd numeric(18,4),        -- null = unlimited
  active boolean not null default true);
-- seed: ('manager', 1000.00), ('admin', null)
```

## 2.3 Accounting

```sql
create table accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, type account_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
-- seed:
--  1000 Cash / Bank (asset)            2000 Accounts Payable (liability)
--  3000 Owner Equity (equity)          4000 Sales / Service Income (income)
--  6000 Office Supplies Expense (exp)  6100 IT / Components Expense (exp)
--  6900 Misc Expense (expense)

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  memo text,
  currency currency not null default 'USD',
  exchange_rate numeric(18,6) not null default 1,
  source journal_source not null,
  source_ref uuid,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_entries (id) on delete cascade,
  account_id uuid not null references accounts (id),
  debit_usd numeric(18,4) not null default 0,
  credit_usd numeric(18,4) not null default 0,
  dimension_department_id uuid references departments (id),
  dimension_project_id uuid references projects (id),
  created_at timestamptz not null default now(),
  constraint journal_line_one_sided check (
    debit_usd >= 0 and credit_usd >= 0 and not (debit_usd > 0 and credit_usd > 0)));
create index journal_lines_entry_idx   on journal_lines (entry_id);
create index journal_lines_account_idx on journal_lines (account_id);

create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  rate_date date not null, currency currency not null,
  rate_to_usd numeric(18,6) not null,
  source rate_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rate_date, currency));

create table budgets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references departments (id),
  project_id uuid references projects (id),
  category text,
  period date not null,                    -- first day of the budget month
  amount_usd numeric(18,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  telegram_sent boolean not null default false,
  read boolean not null default false,
  created_at timestamptz not null default now());
create index notifications_user_idx on notifications (user_id, read);
```

## 2.4 Inventory

```sql
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, description text,
  expense_account_id uuid references accounts (id),   -- C1
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
-- seed: Electronics / Tools / Materials -> account 6100,
--       Office Supplies -> account 6000

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique, name text not null, category text,
  unit text not null default 'pcs',
  stock_qty     numeric(18,4) not null default 0,
  reorder_point numeric(18,4) not null default 0,
  reorder_qty   numeric(18,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table inventory_claims (
  id uuid primary key default gen_random_uuid(),
  po_id uuid references purchase_orders (id),
  po_item_id uuid references purchase_order_items (id),
  inventory_item_id uuid not null references inventory_items (id),
  qty_claimed numeric(18,4) not null check (qty_claimed > 0),
  status claim_status not null default 'pending',
  receipt_object_key text,
  claimed_by uuid references users (id),
  confirmed_by uuid references users (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index inventory_claims_po_idx on inventory_claims (po_id);

create table stock_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references users (id),
  inventory_item_id uuid not null references inventory_items (id),
  qty numeric(18,4) not null check (qty > 0),
  status stock_request_status not null default 'pending',
  priority stock_priority not null default 'medium',
  department text,
  approved_by uuid references users (id), approved_at timestamptz,
  fulfilled_by uuid references users (id), fulfilled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index stock_requests_requester_idx on stock_requests (requester_id);

-- append-only ledger; written ONLY by triggers and the adjust-stock service method
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id),
  delta numeric(18,4) not null,               -- +in / -out
  reason movement_reason not null,
  ref_table text, ref_id uuid,
  balance_after numeric(18,4) not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now());
create index stock_movements_item_idx on stock_movements (inventory_item_id, created_at);
```

## 2.5 Procurement

```sql
create sequence pr_number_seq start 1;
create sequence po_number_seq start 1;

create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  pr_number text not null default 'PR-' || lpad(nextval('pr_number_seq')::text, 4, '0'),
  requester_id uuid not null references users (id),
  status pr_status not null default 'draft',
  currency currency not null default 'USD',
  exchange_rate  numeric(18,6) not null default 1,
  total_original numeric(18,4) not null default 0,
  total_usd      numeric(18,4) not null default 0,
  department_id uuid references departments (id),
  project_id    uuid references projects (id),
  note text,
  approver_id uuid references users (id),
  decided_at timestamptz,
  telegram_message_id bigint, telegram_chat_id bigint,
  auto_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index purchase_requests_requester_idx on purchase_requests (requester_id);
create index purchase_requests_status_idx    on purchase_requests (status);

create table purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references purchase_requests (id) on delete cascade,
  name text not null,
  qty numeric(18,4) not null default 1,
  unit_price_original numeric(18,4) not null default 0,
  inventory_item_id uuid references inventory_items (id),
  category text,
  created_at timestamptz not null default now());
create index purchase_request_items_pr_idx on purchase_request_items (pr_id);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null default 'PO-' || lpad(nextval('po_number_seq')::text, 4, '0'),
  pr_id uuid references purchase_requests (id),
  type po_type not null default 'online',
  supplier text,                                       -- legacy free text, kept for backfill
  supplier_id uuid references suppliers (id),          -- C4
  expense_account_id uuid references accounts (id),    -- C1
  currency currency not null default 'USD',
  exchange_rate  numeric(18,6) not null default 1,
  status po_status not null default 'open',
  payment_status payment_status not null default 'unpaid',
  total_original numeric(18,4) not null default 0,
  total_usd      numeric(18,4) not null default 0,
  department_id uuid references departments (id),
  project_id    uuid references projects (id),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index purchase_orders_status_idx on purchase_orders (status);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders (id) on delete cascade,
  inventory_item_id uuid references inventory_items (id),
  name text not null,
  qty_ordered numeric(18,4) not null default 1,
  qty_claimed numeric(18,4) not null default 0,
  unit_price_original numeric(18,4) not null default 0,
  created_at timestamptz not null default now());
create index purchase_order_items_po_idx on purchase_order_items (po_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  po_id uuid references purchase_orders (id),          -- nullable: direct expense
  amount_original numeric(18,4) not null,
  currency currency not null default 'USD',
  exchange_rate numeric(18,6) not null default 1,
  amount_usd numeric(18,4) not null default 0,         -- derived by trigger
  expense_account_id uuid references accounts (id),    -- C1, required when po_id is null
  method payment_method,
  bank_account text, reference text, trx_id text,
  sender text, transfer_to text, remark text,
  paid_at timestamptz not null default now(),
  receipt_object_key text,
  recorded_by uuid references users (id),
  journal_entry_id uuid references journal_entries (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index payments_po_idx on payments (po_id);
```

## 2.6 Audit & integration

```sql
create table activity_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,   -- purchase_request | purchase_order | payment | stock_request
  entity_id uuid not null,
  action text not null,        -- created | approved | rejected | converted | cancelled
                               -- | payment_recorded | fulfilled | ...
  actor_id uuid references users (id),
  detail jsonb,
  created_at timestamptz not null default now());
create index activity_events_entity_idx on activity_events (entity_type, entity_id, created_at);
create index activity_events_actor_idx  on activity_events (actor_id);

create table telegram_updates (           -- webhook idempotency
  update_id bigint primary key,
  processed_at timestamptz not null default now());
```

## 2.7 Invariants — keep these in Postgres

These are the authority. Implement them as raw SQL inside TypeORM migrations, not in the
service layer; services call the DB and re-read the row. `set_updated_at()` is the usual
`new.updated_at = now()` trigger, on every table with that column.

**T1 — derive USD amounts.** `before insert or update of amount_original, exchange_rate on
payments`, and the same for `total_original, exchange_rate` on `purchase_requests` and
`purchase_orders`. Raise if `exchange_rate is null or <= 0`; otherwise
`amount_usd := round(amount_original / exchange_rate, 4)` (`total_usd` from `total_original`).

**T2 — journal entries must balance.** A **deferrable initially deferred** constraint trigger
`after insert or update or delete on journal_lines`: if the parent entry still exists and
`round(sum(debit_usd),4) <> round(sum(credit_usd),4)`, raise.

**T3 — claim confirmed.** `before update of status on inventory_claims`, when status becomes
`confirmed`:
1. **C3 guard:** raise if `po_item.qty_claimed + new.qty_claimed > po_item.qty_ordered`
   (times `1 + RECEIPT_TOLERANCE_PCT`).
2. set `confirmed_at`, `inventory_items.stock_qty += qty_claimed`,
3. insert a `stock_movements` row (`reason='claim'`, `ref_table='inventory_claims'`,
   `balance_after` = new stock),
4. `purchase_order_items.qty_claimed += qty_claimed`,
5. recompute the PO: `complete` if every line has `qty_claimed >= qty_ordered`, else
   `partial` (skip when the PO is `cancelled`).

**T4 — stock request fulfilled.** `before update of status on stock_requests`, when status
becomes `fulfilled`: lock the item `for update`; raise if `stock_qty < qty`; decrement;
append a `stock_movements` row (`reason='stock_request'`); then **auto-reorder** — if the new
balance `<= reorder_point` and `reorder_qty > 0`, insert a `draft`, `auto_generated`
purchase_request (USD, rate 1, note `Auto-reorder: <sku> at/below reorder point`) with one
item for `reorder_qty`, and insert a `stock_below_reorder` notification for every active
manager and admin.

**T5 — payment recorded.** `after insert on payments`:
1. **C3 guard:** raise if `sum(existing amount_usd for this po) + new.amount_usd >
   po.total_usd * (1 + PAYMENT_TOLERANCE_PCT)`.
2. **C1:** resolve the expense account as
   `coalesce(po.expense_account_id, new.expense_account_id, account '6900')`.
3. Insert a `journal_entries` row (`source='po_payment'`, `source_ref=payment.id`,
   memo `Payment for <po_number>` or `Payment (direct expense)`, the payment's currency and
   rate, `entry_date = paid_at::date`).
4. Insert two `journal_lines`: DR resolved expense account `amount_usd`, CR account `1000`
   `amount_usd`, both carrying the PO's department and project as dimensions.
5. `payments.journal_entry_id = entry`.
6. Roll up `purchase_orders.payment_status`: `paid` when total paid `>= po.total_usd`,
   `unpaid` when `<= 0`, else `partial`.

**T6 — C2, no self-approval.** `before update of status on purchase_requests`: when status
becomes `approved` or `rejected` and `approver_id = requester_id`, raise. (The role check and
the amount-threshold check live in the service layer — see Part 3.)

## 2.8 Validation rules for DTOs

Column types and nullability in the DDL above cover most of it. These are the rules that
the schema does not express:

- **Currency** is always one of `USD | KHR | CNY`. Rate dates are `YYYY-MM-DD`.
- **PR create**: at least one line item; each item needs a non-empty name, `qty > 0`,
  `unit_price_original >= 0`; optional category and inventory item link. Currency required;
  department/project optional. The FX rate is **not** user input — the server looks up the
  day's rate and locks it onto the record.
- **PO create**: an approved `pr_id` is required (reject if the PR is not `approved`); at
  least one line with `qty_ordered > 0` and `unit_price_original >= 0`.
- **Payment**: `amount_original > 0`; method optional; `po_id` optional, but when absent an
  `expense_account_id` is required (C1). All the reconciliation text fields are optional.
- **Claim**: `qty_claimed > 0`, references a PO line.
- **Stock request**: `qty > 0`, priority defaults to `medium`.
- **Inventory item**: `sku` and `name` required, unit defaults to `pcs`,
  `reorder_point`/`reorder_qty >= 0`.
- **Stock adjustment**: delta must be non-zero and may not take stock below zero.
- **User create**: valid email (unique), non-empty name, role from the four values, and a
  mode of `invite | password`; when `password`, minimum 8 characters, otherwise the field
  must be absent. **User update**: same minus email uniqueness against itself, plus
  `active`, optional `telegram_id`, and an optional new password (blank = unchanged).
- **Set password / reset password**: minimum 8 characters, confirmed twice, and the token
  must be unexpired and unused.
- **Income**: `amount_original > 0` and an income account to credit.

Coerce numeric form fields from strings (HTML forms submit strings) — use
`@Type(() => Number)` rather than trusting the transport.

**Dropped from the old Supabase schema:** all RLS policies and grants, `has_role()`,
`handle_new_user()` (there is no `auth.users`), `guard_profile_role()`, `guard_pr_decision()`
and the `adjust_stock()` RPC — everything that depended on `auth.uid()`. Their intent moves
into guards and services.

---

# Part 3 — Instructions for the agent

> **Run these two commands in the new project first**, then hand Claude Code this whole
> document:
>
> ```bash
> # 1. Vendor Flowbite's LLM docs — the authoritative markup source for the whole UI build
> mkdir -p docs && curl -o docs/flowbite-llms-full.txt \
>   https://raw.githubusercontent.com/themesberg/flowbite/refs/heads/main/llms-full.txt
>
> # 2. Add the Flowbite MCP (theme generation in phase 2)
> claude mcp add flowbite -- npx -y flowbite-mcp
> # add --env FIGMA_ACCESS_TOKEN=... only if you also want the Figma-to-code tool
> ```

You are building an operations system in this project, which is based on
brocoders/nestjs-boilerplate (NestJS + TypeORM + Postgres). It is server-rendered with EJS
templates — no React — and talks to plain Postgres: no Supabase, no RLS, no Supabase auth,
no Supabase client.

It replaces an earlier Next.js + Supabase implementation. **You do not have and do not need
that codebase.** This document is the complete specification: Part 1 is what the system must
do, Part 1b is where the old design was wrong and what to build instead, Part 1c is the UI
plan, Part 2 is the schema and the invariants. Where this document describes "today" or "the
legacy app", that is background explaining *why* a rule exists — not a pointer to code you
should go looking for. If something here is ambiguous or looks contradictory, ask me; do not
invent a rule and do not search for a legacy repo.

C5 in Part 1b is a decision I must make — ask me before implementing it, do not pick for me.

## Target architecture
- NestJS modules mirroring the legacy feature slices:
  auth, users (profiles), org (departments/projects/suppliers), procurement (PR/PO/payments),
  inventory (items/categories/claims/movements), stock (requests/fulfil),
  accounting (accounts/journal/rates/budgets/income), reports, activity,
  telegram (bot/webhook/notify/miniapp), files (R2), dashboard.
- Each module: `*.controller.ts` (EJS pages + form POSTs), `*.api.controller.ts`
  (JSON, for the Mini App), `*.service.ts` (business logic), `entities/`, `dto/`.
- Persistence: TypeORM entities + generated migrations. Money columns are
  `numeric(18,4)` with a transformer to string/Decimal — NEVER JS float, and never
  TypeORM `float`/`number` for money.
- Views: EJS with `express-ejs-layouts`, Tailwind built via the CLI into `public/css`.
  **Flowbite is the ONE component library** — its Tailwind plugin plus `flowbite.js`,
  vendored into `public/` at a pinned version, never a CDN. Use Flowbite's component for
  anything it provides (modal, drawer, dropdown, tabs, toast, datepicker, file input,
  stepper, timeline, sidebar, table, badge, forms) and adopt its design language wholesale;
  do NOT hand-roll a parallel set of primitives, and do not mix in a second kit. Alpine.js
  (also vendored) covers only what Flowbite doesn't: the PR/PO line-item repeater, running
  totals, conditional field visibility. Chart.js for the three dashboard charts.
  No React, no SPA router, no bundler.
- **Part 1c is the component-by-component build plan — follow it**, including its Design
  direction section: list and detail pages share one anatomy, one status-colour map, one
  set of partials. Consistency across 20 screens matters far more than any single screen
  looking impressive.
- The Flowbite MCP server is configured in this project. Use its theme-generation tool in
  phase 2 to produce the theme file — ask me for our brand colours first. Do not expect it
  to return component markup; that is not what it does.
- `docs/flowbite-llms-full.txt` in this repo is Flowbite's official LLM documentation dump:
  plain HTML component markup with the correct data-attributes and Tailwind classes.
  **It is the authoritative source for every component you build — grep it for the component
  you need and adapt that markup. Never write Flowbite markup from memory.** Grep it; do not
  read the whole file into context.
- It is the vanilla-HTML Flowbite documentation. Ignore anything you find for Flowbite React
  or Flowbite Svelte — we are building EJS templates, and their markup does not apply.
- Forms use POST-redirect-GET with flash messages (connect-flash or an equivalent),
  and CSRF protection on all state-changing form posts. On validation failure, re-render
  the form with the user's submitted values AND the field errors — never send them back
  to an empty form (see Part 1c §"Three things that genuinely change").
- Validation: class-validator/class-transformer DTOs (the boilerplate's convention),
  derived from the column types and nullability in Part 2 plus the rules in Part 2.8.

## Auth
- Use the boilerplate's auth module (JWT access + refresh, session entity, mail-based
  forgot/reset) as the base.
- **Disable its public registration, email-confirmation sign-up and social login
  (Google/Facebook/Apple), and do not expose routes or UI for them.** Accounts are created
  by admins only, either by sending an invite or by setting an initial password directly —
  both modes are required. See Part 1 §2.10 for both flows and the auth security rules (no user enumeration, single-use tokens,
  rate limiting, inactive users blocked), and Part 2.2 for the `auth_tokens` table. Build
  exactly four public pages: sign in, forgot password, reset password, set password.
- Transactional email is required for this to work at all: configure the boilerplate's
  mailer against a real SMTP provider in phase 2, and build two templates — invite and
  password reset. Log the send failure and surface it to the admin if an invite bounces;
  a silently swallowed invite email looks like a broken account.
- Browser pages authenticate from an httpOnly cookie holding the access token
  (refresh on expiry); the Telegram Mini App authenticates by validating Telegram
  `initData` HMAC and then minting the same JWT. One `AuthGuard`, two entry points.
- The legacy `profiles` table merges into the boilerplate's `User` entity: add
  role (employee|manager|finance|admin), telegram_id, telegram_username,
  telegram_link_token, telegram_link_expires_at, department, active,
  payment_link, payment_qr_object_key. Keep the boilerplate's own status/role seeds
  consistent with these four roles.

## Authorization — this is the part that must not be sloppy
The old system had Postgres row-level security doing half this job. There is none here, so
build BOTH layers in the app:
1. A `PermissionsService` / `@RequirePermission('pr.decide')` guard implementing the
   permission matrix in Part 1 §1 exactly, plus one addition from Part 1b:
   `suppliers.manage` → manager/finance/admin.
2. Row scoping in every service query, following the visibility rules in Part 1 §1
   (e.g. purchase requests: own rows OR manager/finance/admin sees all). A missing
   scope here is a data leak — apply it in the repository query, not in the template.
Three rules that cannot live in the database here, because they need to know who is acting:
   - only manager/admin may move a PR to approved/rejected, and only within their
     `approval_thresholds` limit (C2),
   - only an admin may change a user's role,
   - only manager/admin may adjust stock — an `adjustStock` service method that updates the
     item and appends a `stock_movements` row (`reason='adjustment'`) in one transaction,
     refusing to take stock negative.

## Database
Write TypeORM entities and migrations for the complete schema in Part 2, including the
enums, sequences, indexes and checks. Implement invariants T1–T6 (Part 2.7) as raw SQL
triggers inside the migrations — they are the authority, so do NOT reimplement that logic
in services; call the DB and re-read the row.

Seed: the chart of accounts, the four categories with their expense accounts, the
`approval_thresholds` rows, and one user per role (employee / manager / finance / admin)
for local development.

## Infrastructure to build
- Money: a `MoneyService` (toUsd, round, format, formatUsd) + an EJS filter for display.
  `exchange_rate` = units per 1 USD; `amount_usd = amount_original / exchange_rate`;
  store 4dp, display 2dp. Never use JS floats or TypeORM `float`/`number` for money.
- Rates: `getCurrentRate(currency)` returns the most recent `exchange_rates` row on or
  before today (USD is always 1), and a `@nestjs/schedule` daily cron that fetches and
  stores rates with `source='api'`. Finance/admin can override a day's rate manually.
- Files: Cloudflare R2 via the boilerplate's S3 file driver (R2 is S3-compatible) —
  presigned PUT for direct browser upload, short-TTL presigned GET for viewing,
  persist only the object key. Set `requestChecksumCalculation: "WHEN_REQUIRED"`: R2
  rejects the AWS SDK's default CRC32 on presigned PUTs.
- Activity log: an `ActivityService.log()` writing one `activity_events` row, called from
  every state-changing action; best-effort, never rolls back the caller's transaction.
- Telegram: grammY. One `NotificationsService.notify(event, payload)` abstraction —
  business logic never calls the Bot API directly. All 9 events and the routing table in
  Part 1 §2.8, the in-app `notifications` row on every send, the inline approve / reject /
  confirm / fulfil callbacks with role checks, the webhook secret-token header check, and
  `telegram_updates` for idempotency.
- Mini App: one EJS shell + vanilla JS at /miniapp, with a JSON API under /api/miniapp
  (data, pr, stock, claim, history, history/pr/:id, history/claim/:id, history/stock/:id,
  notify), authenticated by Telegram initData HMAC.
- Receipt OCR: OCR.space engine 2 with `isTable=true`, which returns tab-separated
  `label<TAB>value` rows. Build a lowercased label→value map and extract: amount +
  currency (`([0-9,]+\.?\d*)\s*(USD|KHR|CNY)` from "original amount" or "amount"),
  reference, trx id, sender, remark, to-account, transaction date, and "Transfer to NAME"
  from the receipt header. Every field may be absent — return nulls, never throw.
- Reports: the 8 reports in Part 1 §2.5 plus the spend-by-supplier report from C4, each
  with the date-range filter and CSV export.

## Plan of work — do it in this order, and stop for my review after each phase
1. Schema: entities + migrations + triggers + seeds, including the C1–C4 corrections.
   Verify with a fresh `db:reset`. Ask me about C5 before touching the payment trigger.
2. Auth + users + roles/permissions guards + the app shell layout (EJS, sidebar,
   header, mobile nav, theme, flash messages, CSRF). Wire up Flowbite here and build the
   shared EJS partial kit on top of it — form field + error, table, badge/status badge,
   modal, tabs, timeline, stepper, toast, pagination — so later phases assemble pages
   instead of inventing markup. This is the phase that sets whether the UI port stays
   cheap. Show me the shell and the partial kit before moving on.
3. Procurement: PR → approve → PO → payment (+ receipt upload, OCR, cancel flows,
   the unified stepper, activity timeline on detail pages). Includes the suppliers
   module (C4), approval thresholds + self-approval block (C2), and the expense-account
   resolution on the PO form (C1).
4. Inventory + stock: catalog, categories (now carrying expense_account_id), claims
   with the over-receipt guard, stock requests, fulfil, adjustments, movement history,
   auto-reorder.
5. Accounting + reports + dashboard (three Chart.js charts from vendored public/js,
   fed by JSON embedded in the template). Add the spend-by-supplier report. Verify that
   expense-by-category now returns more than one row — that is the acceptance test for C1.
6. Telegram bot, notifications, and Mini App.
7. Admin (users, departments, projects, settings) + profile page.

Rules for how you work:
- Before writing NestJS-specific or TypeORM-specific code, check the actual installed
  versions and their docs in node_modules — do not rely on memory for API shapes.
- Match the boilerplate's existing conventions (module layout, DTO style, config
  service, i18n, exception filters) rather than inventing new ones.
- No feature drops and no silent redesigns: if something specified here cannot be built
  as described, implement the closest equivalent and say so explicitly in your summary.
- After each phase: run the build and lint, tell me what you verified and what you
  could not, and wait.

---

# Part 4 — Open decisions

These are mine to settle, not yours to resolve. Raise them if I have not.

1. **Keep the triggers or move logic into services?** The brief above says keep them — they are already written, tested, and they hold for any client (bot, Mini App, web). The cost is that TypeORM entities won't know about the derived columns, so every write must re-read the row.
2. **UI**: see Part 1c for the full port plan. Short version — Flowbite is the single component library (adopting its look, losing the current shadcn identity), the vendored primitive layer (~3,500 LOC) collapses into Flowbite components and native HTML inputs, the real work is ~20 feature components, and the Telegram Mini App (1,314 lines) is the one piece that should stay client-rendered rather than becoming server-rendered pages. **Look at Flowbite's actual components before committing** — the design language is the one decision here you cannot cheaply reverse later.
3. **Data migration**: the prompt covers the *schema*. If you need existing Supabase rows moved too, that's a separate `pg_dump --data-only` + column-mapping pass — say so and it can be added as phase 0. Note that C1 and C4 both need backfill rules for existing rows: old POs get `expense_account_id` derived from their lines' categories (else 6900), and each distinct trimmed `supplier` string becomes one `suppliers` row.
4. **C5 (cash-basis vs accrual) is the one thing to settle before phase 5.** Everything in the reporting layer rests on it, and switching afterwards means reposting history.
5. **Transactional email** is still needed for invites and password resets — pick a provider (Resend/Postmark/SES/…) and set up the domain and DNS before phase 2. It is no longer a hard blocker for account creation, since an admin can set a password directly, which also solves bootstrapping your **first production admin** (seed one account, then work through the UI).
6. **Environment/config mapping.** Every `NEXT_PUBLIC_*` and Supabase env var disappears; R2, Telegram (bot token, webhook secret, group/topic ids), OCR.space, the FX rate API and the new SMTP settings all move into the boilerplate's config module with validation. Worth doing as a single pass in phase 1 rather than discovering them one at a time.
7. **Tests.** The legacy app has no test runner at all; the boilerplate ships e2e tests. Decide whether the port keeps them — if yes, the money math, the permission matrix, and the five trigger-enforced invariants are the things worth covering, and that is a real scope addition.
