#!/usr/bin/env bash
set -e

/opt/wait-for-it.sh postgres:5432
/opt/wait-for-it.sh maildev:1080
pnpm install --frozen-lockfile
pnpm run migrate
pnpm run seed
pnpm run start:dev
