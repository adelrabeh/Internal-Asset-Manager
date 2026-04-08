#!/bin/sh
set -e

echo "Running database migrations..."
cd /app
node node_modules/.bin/drizzle-kit push --config lib/db/drizzle.config.ts --force || echo "Migration warning (continuing...)"

echo "Starting server..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
