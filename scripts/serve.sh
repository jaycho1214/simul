#!/usr/bin/env bash
# Headless: runs just the server (no Electron window). Useful for testing the
# attendee page without the operator app.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "!! No .env found (need GEMINI_API_KEY and INGEST_TOKEN)"; exit 1; }
pnpm --filter @tongyeok/web build >/dev/null
LAN=$(ipconfig getifaddr en0 2>/dev/null || echo localhost)
echo "  Attendees open : http://${LAN}:${PORT:-8080}"
set -a; . ./.env; set +a
exec node --disable-warning=ExperimentalWarning --experimental-transform-types \
  --env-file-if-exists=.env "$PWD/apps/server/src/index.ts"
