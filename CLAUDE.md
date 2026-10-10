# Project instructions

Internal operations system (procurement, inventory, stock, accounting) on NestJS 11, EJS
views and PostgreSQL through Prisma ORM 8.

## Database schema changes

Use the `schema-change` skill ([.claude/skills/schema-change/SKILL.md](.claude/skills/schema-change/SKILL.md)):
edit `src/prisma/contract.prisma`, emit, plan a migration, apply it with `npm run migrate`.
Seeds live in `src/database/seeds/seed.ts` (`npm run seed`).

## Branches and deploys

- `develop` is the default branch. Branch from it and open PRs against it.
- `main` is production. Merging `develop` into `main` runs CI, then `.github/workflows/deploy.yml` deploys to AWS (ECS + RDS), running migrations first. Only merge to `main` to release.
- Hosting is AWS only (see `infra/`). Vercel and Heroku are no longer used.
