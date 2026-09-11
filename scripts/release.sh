#!/usr/bin/env bash
# Cuts a release: writes the version into apps/operator/package.json (the one
# Electron Forge and the app read), commits, tags v<version> and pushes both.
# The tag push starts .github/workflows/release.yml, whose first step refuses
# a tag that does not match that version — so bumping and tagging live in one
# command to make that mismatch impossible to produce by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: pnpm release <major.minor.patch>" >&2
  exit 1
fi
if [ "$(git branch --show-current)" != "main" ]; then
  echo "!! releases are cut from main (currently on $(git branch --show-current))" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "!! working tree is not clean" >&2
  exit 1
fi
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "!! local main differs from origin/main — pull or push first" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "!! tag v$version already exists" >&2
  exit 1
fi

# The very first release ships the version already in package.json; npm
# version refuses a no-op bump, so only bump when the number actually changes.
current="$(node -p "require('./apps/operator/package.json').version")"
if [ "$current" != "$version" ]; then
  (cd apps/operator && npm version "$version" --no-git-tag-version >/dev/null)
  git add apps/operator/package.json
  git commit -q -m "chore(release): v$version"
fi
git tag -a "v$version" -m "Simul v$version"
git push origin main "v$version"

echo "==> Pushed v$version. Follow the build with: gh run watch"
