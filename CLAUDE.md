# Project instructions

NestJS boilerplate supporting both relational (TypeORM/PostgreSQL) and document (Mongoose/MongoDB) persistence.

## When adding entities, schemas, or properties

Use the `generate` skill (auto-loaded from [.claude/skills/generate/SKILL.md](.claude/skills/generate/SKILL.md)). It documents the project's CLI generators (`npm run generate:resource:*`, `npm run add:property:to-*`) which keep both database variants, DTOs, modules, and migrations in sync. Do not hand-write entity files.

## Branches and deploys

- `develop` is the default branch. Branch from it and open PRs against it.
- `main` is production. Merging `develop` into `main` runs CI, then `.github/workflows/deploy.yml` deploys to AWS (ECS + RDS), running migrations first. Only merge to `main` to release.
- Hosting is AWS only (see `infra/`). Vercel and Heroku are no longer used.
