#!/usr/bin/env bash
set -e

/opt/wait-for-it.sh postgres:5432
pnpm run migrate:prod
pnpm run seed:prod
pnpm run start:prod > prod.log 2>&1 &
/opt/wait-for-it.sh maildev:1080
/opt/wait-for-it.sh localhost:3001
pnpm run lint
pnpm run test:e2e --runInBand
