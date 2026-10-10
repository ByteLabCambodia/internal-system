#!/usr/bin/env bash
set -e

/opt/wait-for-it.sh postgres:5432
pnpm run migrate:prod
pnpm run seed:prod
pnpm run start:prod
