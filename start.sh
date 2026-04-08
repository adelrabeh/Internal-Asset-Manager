#!/bin/sh
set -e
echo "Running database migrations..."
node node_modules/.bin/drizzle-kit push --config lib/db/drizzle.config.ts --force || echo "Migration warning"
echo "Starting server..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
