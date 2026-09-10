#!/usr/bin/env bash
# Opens the Electron operator app. The app forks the translation server itself
# into a utilityProcess, so this is the only thing you need to run.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "!! No .env found. Create one with:"
  echo "   GEMINI_API_KEY=your-key"
  echo "   INGEST_TOKEN=any-shared-secret"
  exit 1
fi

echo "==> Building the attendee app (served by the server the app starts)..."
pnpm --filter @tongyeok/web build >/dev/null

LAN=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "")
PORT="${PORT:-8080}"
echo ""
echo "  Attendees open : http://${LAN:-localhost}:${PORT}"
echo "  Feed test audio: pnpm tone"
echo ""
echo "==> Opening the operator app (server logs appear in its window)..."
set -a; . ./.env; set +a
export WEB_ROOT="$PWD/apps/web/dist"
exec pnpm --filter operator start
