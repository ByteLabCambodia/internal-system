#!/usr/bin/env bash
set -e

/opt/wait-for-it.sh postgres:5432
npm run migrate:prod
npm run seed:prod
npm run start:prod
