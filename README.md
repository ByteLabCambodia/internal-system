# ByteLab Internal System

ByteLab's internal operations system: procurement, inventory, stock, sales and accounting
in one web app, with Telegram notifications.

Built with NestJS 11, server-rendered EJS views (Tailwind + Flowbite + Alpine) and
PostgreSQL through Prisma ORM 8.

## What it does

| Area        | What you can do                                                             |
| ----------- | --------------------------------------------------------------------------- |
| Procurement | Purchase requests and orders, approvals, supplier payments                  |
| Inventory   | Items, categories, employee claims                                          |
| Stock       | Stock requests with priorities and reorder alerts                           |
| Sales       | Customers, quotations, invoices and receipts, PDF in Khmer, English or both |
| Accounting  | Chart of accounts, double-entry journal, exchange rates, reports            |
| Admin       | Users, roles and permissions, organisation, company settings                |
| Telegram    | Account linking, notifications and a mini app                               |

Money is stored in USD with the exchange rate locked per document. Roles (admin, manager,
finance, employee) decide what each person can see and do.

## Quick start

You need Node 24 (see `.nvmrc`), [pnpm](https://pnpm.io) and Docker.

```bash
cp env-example-relational .env
# in .env: set DATABASE_HOST=localhost and MAIL_HOST=localhost
docker compose up -d postgres adminer maildev
pnpm install
pnpm run migrate
pnpm run seed
pnpm run start:dev
```

Open <http://localhost:3001>. The seed creates one login per role:
`admin@example.com`, `manager@example.com`, `finance@example.com` and
`employee@example.com`, all with the password `secret`. Change these before any real use.
Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` to also create your own admin.

Local tools: Adminer <http://localhost:8080>, Maildev <http://localhost:1080>.

## Common commands

| Command                     | What it does                                      |
| --------------------------- | ------------------------------------------------- |
| `pnpm run start:dev`        | Build the CSS and run the app with reload         |
| `pnpm run css:watch`        | Rebuild Tailwind on change                        |
| `pnpm run migrate`          | Apply database migrations                         |
| `pnpm run seed`             | Insert roles, accounts, categories and demo users |
| `pnpm run migration:plan`   | Emit the schema and plan a new migration          |
| `pnpm test`                 | Unit tests                                        |
| `pnpm run test:integration` | Services against a real Postgres                  |
| `pnpm run test:browser`     | Playwright against the built app                  |
| `pnpm run lint`             | ESLint                                            |

## Changing the database

Edit `src/prisma/contract.prisma`, then plan and apply a migration. Step by step:
[.claude/skills/schema-change/SKILL.md](.claude/skills/schema-change/SKILL.md).

## Project layout

```text
src/
  procurement/ inventory/ stock/ sales/ accounting/   business modules
  org/ users/ roles/ permissions/ admin/              people and access
  auth/ session/ telegram/ notifications/ mail/       sign in and messaging
  views/                                              EJS pages and partials
  prisma/ database/                                   schema, migrations, seeds
migrations/   SQL migrations and snapshots
infra/        AWS infrastructure (Terraform)
docs/         deeper guides (architecture, auth, database, tests)
```

## Branches and deploys

- `develop` is the default branch. Branch from it and open pull requests against it.
- `main` is production. Merging `develop` into `main` runs CI, then
  `.github/workflows/deploy.yml` deploys to AWS (ECS and RDS), running migrations first.
- Only merge to `main` to release.

## More docs

See [docs/readme.md](docs/readme.md) for architecture, authentication, database, file
uploads, translations and testing.

## License

[MIT](LICENSE)
