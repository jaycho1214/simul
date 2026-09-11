#!/usr/bin/env bash
# Opens the Electron operator app. The app forks the translation server itself
# into a utilityProcess, so this is the only thing you need to run.
#
# The app's own settings (the panels in its window) are the server's only
# configuration: the Gemini API key goes in 제어, the languages in 언어. A .env
# file is read by `pnpm serve` (the headless server) alone; nothing in it
# reaches the app, and the app strips every server variable it inherits.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Building the attendee app (served by the server the app starts)..."
pnpm --filter @simul/web build >/dev/null

LAN=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "")
PORT="${PORT:-8080}"
echo ""
echo "  Attendees open : http://${LAN:-localhost}:${PORT}"
echo "  API key        : set it in the app's 제어 panel (not .env)"
echo "  Feed test audio: pnpm tone"
echo ""
echo "==> Opening the operator app (server logs appear in its window)..."
export WEB_ROOT="$PWD/apps/web/dist"
exec pnpm --filter operator start
