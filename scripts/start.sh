#!/usr/bin/env bash
# One command to run the whole system: builds the attendee app and serves it
# from the translation server, then prints the URLs to open.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

if [ ! -f .env ]; then
  echo "!! No .env found. Create one with:"
  echo "   GEMINI_API_KEY=your-key"
  echo "   INGEST_TOKEN=any-shared-secret"
  exit 1
fi

echo "==> Building the attendee app..."
pnpm --filter @tongyeok/web build >/dev/null

LAN=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "")
PORT="${PORT:-8080}"

echo ""
echo "  On this machine : http://localhost:${PORT}"
[ -n "$LAN" ] && echo "  From a phone    : http://${LAN}:${PORT}   (same wifi)"
echo ""
echo "  Pick 한국어 to hear the passthrough lane (needs no API key)."
echo "  Feed it audio with:  pnpm tone"
echo ""
echo "==> Starting server (Ctrl-C to stop)..."
set -a; . ./.env; set +a
exec node --disable-warning=ExperimentalWarning --experimental-transform-types \
  --env-file-if-exists=.env \
  "$ROOT/apps/server/src/index.ts"
