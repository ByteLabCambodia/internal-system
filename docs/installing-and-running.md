# Installation

The app runs on PostgreSQL through [Prisma ORM 8](database.md).

## Table of Contents <!-- omit in toc -->

- [Local development](#local-development)
- [Quick run with Docker](#quick-run-with-docker)
- [Links](#links)

## Local development

The project uses [pnpm](https://pnpm.io) (version pinned in `package.json`'s
`packageManager`). Install it once with `corepack enable` or `npm install -g pnpm`.

1. Copy the example environment and point it at your machine:

   ```bash
   cp env-example-relational .env
   ```

   Change `DATABASE_HOST=postgres` to `DATABASE_HOST=localhost` and `MAIL_HOST=maildev` to
   `MAIL_HOST=localhost` (or set `DATABASE_URL`).

1. Start Postgres and Maildev (or use a local Postgres):

   ```bash
   docker compose up -d postgres adminer maildev
   ```

1. Install, migrate and seed:

   ```bash
   pnpm install
   pnpm run migrate   # builds or upgrades the schema (src/database/migrate.ts)
   pnpm run seed      # roles, chart of accounts, categories, one login per role
   ```

   The seeded logins are `admin@example.com`, `manager@example.com`,
   `finance@example.com` and `employee@example.com`, all with the password `secret`. Set
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` to also create your own admin account.

1. Run the app in dev mode and open <http://localhost:3001>:

   ```bash
   pnpm run start:dev
   ```

## Quick run with Docker

```bash
cp env-example-relational .env
docker compose up -d
docker compose logs
```

The container migrates and seeds on start. Open <http://localhost:3001>.

## Links

- Swagger (API docs): <http://localhost:3001/docs>
- Adminer (client for DB): <http://localhost:8080>
- Maildev: <http://localhost:1080>

---

Previous: [Introduction](introduction.md)

Next: [Architecture](architecture.md)
