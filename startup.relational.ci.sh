#!/usr/bin/env bash
set -e

/opt/wait-for-it.sh postgres:5432
npm run migrate:prod
npm run seed:prod
npm run start:prod > prod.log 2>&1 &
/opt/wait-for-it.sh maildev:1080
/opt/wait-for-it.sh localhost:3001
npm run lint
npm run test:e2e -- --runInBand
