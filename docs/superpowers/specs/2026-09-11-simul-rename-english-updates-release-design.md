# Simul: rename, English UI, auto-update, release pipeline

**Date:** 2026-09-11
**Status:** approved in discussion, awaiting spec review

## Summary

Five pieces of work that turn the `tongyeok` prototype into a publishable
product called **Simul**, done in this order on top of `feat/live-translation`:

0. Add Prettier, commit the pending work, format the repo, merge to `main`.
1. Rename `tongyeok` → `simul` everywhere.
2. Give the operator app an English UI with a persisted language switch.
3. Add Windows auto-update from GitHub Releases, surfaced as a toast.
4. Add GitHub Actions (CI + Windows release), a release script, and a README;
   create the public repo `jaycho1214/simul` and publish `v0.1.0`.

Decisions already taken with the owner:

- Name: **Simul** (interpreter jargon for simultaneous interpretation).
- Repo `jaycho1214/simul` is **public** — this is what makes the zero-config
  update path possible.
- No settings migration: nothing is installed anywhere yet.
- No LICENSE file unless the owner names one (public + no license = all
  rights reserved; flagged, not decided).

## Non-goals

- Code signing (Windows or macOS). Needs a certificate; SmartScreen will warn
  on first install exactly as it does today.
- macOS distribution or macOS auto-update. The mac build stays a dev-only zip.
- An app icon. Squirrel keeps the default until one is supplied.
- Renaming the owner's local folder `~/Codes/tongyeok`.
- Tailwind class sorting in Prettier.

---

## 0. Prettier, commit, merge

### Commits on `feat/live-translation`

1. **Pending work, as-is.** `git status` shows ~66 modified and ~32 new files
   (brand panel and `/brand` route, MSE audio controller, language panel,
   operator rail/toolbar, transcript segmenting, …). Run `pnpm typecheck &&
   pnpm test` first; commit only if green, otherwise stop and report. One
   commit, message describing the redesign work it contains.
2. **`chore: add prettier and format the repo`.** Nothing but formatting and
   the config below, so `git blame` past this commit is one `--ignore-rev`
   away.

### Prettier configuration

- Root `devDependencies`: `prettier@^3`.
- `.prettierrc`: `{ "printWidth": 100 }`. Everything else is Prettier 3's
  default (double quotes, semicolons, `trailingComma: "all"`), which is what
  the code already uses; the diff is line-wrapping, not style.
- `.prettierignore`: `node_modules`, `dist`, `.vite`, `out`,
  `pnpm-lock.yaml`, `apps/operator/src/routeTree.gen.ts`. The two
  hand-written preview pages under `apps/web` are formatted like everything
  else.
- Root scripts: `"format": "prettier --write ."`,
  `"format:check": "prettier --check ."`.
- `.git-blame-ignore-revs` listing the format commit's hash, added in the
  same or the following commit.

### Merge

`git checkout main && git merge --ff-only feat/live-translation`. The branch
is a linear descendant of `main` (77 commits ahead, 0 behind), so this is a
pointer move. Then `git checkout -b feat/simul` for sections 1–4, merged the
same way at the end.

---

## 1. Rename → Simul

Rule: the romanised identifier `tongyeok` disappears from the tree
(`grep -ri tongyeok . --exclude-dir=node_modules` returns nothing). The Korean
word 통역 in UI copy is a word, not the name, and stays.

| Where | From | To |
| --- | --- | --- |
| Root `package.json` name | `tongyeok` | `simul` |
| Workspace packages | `@tongyeok/{protocol,server,operator,web}` | `@simul/{…}` |
| `apps/operator/package.json` `productName` | `tongyeok` | `Simul` |
| `forge.config.ts` `packagerConfig.name` | `tongyeok` | `Simul` |
| `executableName` | `tongyeok` | `simul` |
| `appBundleId` | `kr.tongyeok.operator` | `io.github.jaycho1214.simul` |
| `MakerSquirrel` | `name: "tongyeok"`, `tongyeok-setup.exe` | `name: "Simul"`, `Simul-Setup.exe` |
| `NSMicrophoneUsageDescription` | Korean | English: "Simul needs microphone access to capture the mixer's audio." |
| Env var | `TONGYEOK_EXTERNAL_SERVER` | `SIMUL_EXTERNAL_SERVER` |
| electron-store name | `tongyeok-operator` | `simul-operator` |
| Log prefixes / comments / test names | `[tongyeok]`, "tongyeok" | `[simul]`, "Simul" |
| Web `localStorage` keys, `frames.html`, `theme.ts` | `tongyeok…` | `simul…` |
| `scripts/*.sh`, `docs/**` (including dated plans/specs) | `@tongyeok/web`, "tongyeok" | `@simul/web`, "Simul" |

After the package renames, `pnpm install` refreshes `pnpm-lock.yaml`
(workspace links are keyed by name). `pnpm typecheck && pnpm test` must stay
green; `pnpm --filter @simul/operator package` must still produce an app whose
`Resources/dist` and `node_modules/opusscript` copies land as before.

---

## 2. English for the operator UI

### Strings

- `apps/operator/src/localization/locales/ko.ts` — the current `KO_STRINGS`
  table, moved verbatim (still exported as `KO_STRINGS` for the existing test).
- `apps/operator/src/localization/locales/en.ts` — `EN_STRINGS`, the same key
  tree in English. Its declared type is derived from the Korean table
  (`type Strings = Deep<typeof KO_STRINGS, string>`), so a missing or extra
  key is a compile error, not a runtime blank.
- `i18n.ts` registers both: `supportedLngs: ["ko", "en"]`, `fallbackLng: "ko"`
  (Korean is the complete, hand-checked table; if a key were ever missing in
  English the reader sees Korean rather than a raw key).
- `i18n.test.ts` gains: identical leaf key sets in `ko` and `en`, and identical
  `{{placeholder}}` sets per key. The existing "no Latin copy in Korean" test
  is unchanged.
- `index.html` `<title>` becomes `Simul`; the `<html lang>` attribute is set
  at runtime from the active language.

### Main-process strings

`main.ts` and `ipc/settings` carry a handful of Korean strings that never go
through i18next: the close-confirmation dialog, the logo picker title, two
logo validation errors. They move to `localization/main-strings.ts` — a plain
`{ ko: {...}, en: {...} }` object with a `mainStrings(lang)` accessor — and
read the language from settings at the moment they are shown. The whole app
follows one setting; there are no bilingual exceptions.

### Setting and switch

- `OperatorSettings.uiLanguage: "ko" | "en" | null`. `null` (the default)
  means "follow the OS": the renderer resolves it as `ko` when
  `navigator.language` starts with `ko`, else `en`; the main process uses
  `app.getLocale()` the same way. Shared helper `resolveUiLanguage(setting,
  osLocale)` in `settings/ui-language.ts`, unit-tested.
- `normalizeSettings` accepts only `"ko"`/`"en"`, anything else → `null`.
  `patchSchema` and `PublicSettings` carry the field.
- Switch: a **한국어 | English** `ToggleGroup` in the rail footer, below the
  Start/Stop buttons. Selecting a value persists it (`settings.set`) and calls
  `i18n.changeLanguage` immediately; no restart, no reload. The value in the
  toggle is the *resolved* language, so a fresh install shows the language it
  is actually using, not an empty control.
- On renderer start, `app.tsx` resolves the language from `settings.get()`
  before the first render so the window never flashes Korean on an English
  machine (or vice versa).

---

## 3. Auto-update (Windows)

### Approach

`update-electron-app` against `update.electronjs.org`, the path Electron's own
docs recommend for public GitHub Releases + Squirrel.Windows. The service reads
the repo's latest non-draft, non-prerelease release and serves Squirrel the
`RELEASES` + `.nupkg` assets that `@electron-forge/publisher-github` uploads.

Rejected: pointing `autoUpdater` at `github.com/…/releases/latest/download`
directly (works on redirects Squirrel happens to follow; less proven), and
switching to electron-builder/electron-updater (discards a working Forge
setup).

### Behaviour

- Enabled only when `app.isPackaged && process.platform === "win32"`. In
  development and on macOS nothing runs — no timer, no network.
- Checks on launch (after the window is up, not before) and every hour.
  Squirrel downloads and stages a newer version **silently in the
  background**; nothing is shown while that happens.
- On `update-downloaded`, the renderer shows a **persistent, non-modal toast**:
  "업데이트 v0.3.0 준비됨 — 다시 시작하면 적용됩니다" / "Update v0.3.0 is ready
  — restart to apply", with a **Restart** action and a dismiss. It never
  auto-dismisses and never blocks the window.
- **Restart**: if the server is `listening`, the same "this stops translation
  for everyone" confirmation as closing the window; on confirm (or when the
  server is not live) → `autoUpdater.quitAndInstall()`. The existing
  `will-quit` handler stops the server gracefully before `app.exit(0)`, and
  Squirrel's `Update.exe --processStartAndWait` launches the new version after
  this process has exited — so the new server never races the old one for
  port 8080.
- **Dismiss** loses nothing: Squirrel has already staged the new version and
  starts it on the next launch. The rail footer keeps showing the version and,
  while an update is staged, a quiet "다시 시작하여 업데이트 / Restart to
  update" link, so a dismissed toast is recoverable without waiting.
- A small refresh icon beside the version (tooltip "업데이트 확인 / Check for
  updates") triggers a manual check, for the "please update before the
  event" case; on the platforms where the updater is off it is not rendered.
- Errors (offline venue, service down) are logged to the server-log panel's
  buffer with an `[update]` prefix and otherwise silent. An update check must
  never put a dialog or a red badge in front of an engineer during a service.

### Components

- `apps/operator/src/updates/update-state.ts` — pure: an `UpdateState`
  (`{ status: "disabled" | "idle" | "checking" | "downloading" | "ready" |
  "error"; version: string | null; message: string | null }`) and a reducer
  from `autoUpdater` event names (+ payload) to the next state. Unit-tested
  with the full event sequence Electron documents, including
  `update-not-available` after `checking-for-update` and `error` from any
  state.
- `apps/operator/src/updates/auto-update.ts` — main process: guards, calls
  `updateElectronApp({ updateSource: { type: ElectronPublicUpdateService,
  repo: "jaycho1214/simul" }, updateInterval: "1 hour", notifyUser: false,
  logger })`, subscribes to `autoUpdater` and feeds the reducer, exposes
  `state()`, `check()`, `install()`.
- `apps/operator/src/ipc/updates/index.ts` — oRPC procedures `state`,
  `check`, `install`, added to `ipc/router.ts`. `install` owns the
  confirmation dialog and sets the `closeConfirmed` bypass.
- Renderer: `hooks/use-update-state.ts` polls `updates.state` every 5 s (the
  app's existing pattern — the log and status panels poll; there is no push
  channel and this does not add one). `components/update-toast.tsx` mounted
  once in `layouts/base-layout.tsx` turns a transition into `ready` into the
  toast (once per version, keyed by version). `sonner` provides the toast;
  `components/ui/sonner.tsx` is the shadcn wrapper themed to the app palette;
  `<Toaster />` is mounted in the root layout.
- Rail footer: version from the existing `app.appVersion` procedure, the
  check icon, the "restart to update" link.

### Dependencies

`update-electron-app` (runtime), `sonner` (runtime), both in
`apps/operator`. `apps/operator/package.json` gains a `repository` field
pointing at `github:jaycho1214/simul` (update-electron-app validates it).

### Verification

- Unit: the reducer; `resolveUiLanguage`; the toast component's "show once
  per version" logic with a fake state stream.
- Manual, by the owner on a Windows machine, after section 4 has published
  two releases: install `v0.1.0`, publish `v0.1.1`, relaunch or press the
  check icon, confirm the toast appears after the background download,
  Restart, confirm `v0.1.1` in the footer. This cannot be exercised from
  macOS and is called out as the acceptance step for this section.

---

## 4. GitHub Actions, release script, README, repo

### `.github/workflows/ci.yml`

`ubuntu-latest`, on `push` to `main` and `pull_request`: checkout →
`pnpm/action-setup` → `actions/setup-node` (Node 24, pnpm cache) →
`pnpm install --frozen-lockfile` → `pnpm format:check` → `pnpm typecheck` →
`pnpm test`.

### `.github/workflows/release.yml`

`windows-latest`, on `push` of tags `v*` and `workflow_dispatch`;
`permissions: contents: write`.

1. Same setup as CI.
2. **Version guard**: fail unless `${GITHUB_REF_NAME#v}` equals
   `apps/operator/package.json`'s `version`. Squirrel orders releases by
   version; a tag published under the wrong version would either be ignored
   or roll installs backwards.
3. `pnpm --filter @simul/web build` (Forge's `extraResource` copies
   `apps/web/dist`; without this the packaged server has no attendee app).
4. `pnpm --filter @simul/operator exec electron-forge publish` with
   `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

`forge.config.ts` gains `publishers: [new PublisherGithub({ repository: {
owner: "jaycho1214", name: "simul" }, draft: false, prerelease: false,
generateReleaseNotes: true })]`. `draft: false` matters: the publisher's
default is a draft release, and update.electronjs.org ignores drafts.
The uploaded assets are `Simul-Setup.exe`, `Simul-<version>-full.nupkg`
and `RELEASES` — exactly what Squirrel needs.

### `scripts/release.sh <version>`

Refuses on a dirty tree or off `main`; writes `version` into
`apps/operator/package.json`; commits `chore(release): v<version>`; tags
`v<version>`; pushes branch and tag. Exposed as `pnpm release <version>`.
This is what keeps the tag and the version the guard compares from drifting.

### `README.md` (English)

What Simul is (one laptop at the mixer, phones on the venue LAN, live
speech-to-speech translation through Gemini Live); the three apps and the
protocol package; requirements (Node ≥ 23.6, pnpm, a Gemini API key);
quick start (`pnpm install`, `pnpm start`, where the API key goes); headless
`pnpm serve` and `.env`; development (`test`, `typecheck`, `format`);
releasing (`pnpm release x.y.z` → Actions → GitHub Release → installed apps
update themselves); a link to the Korean pre-event checklist; the
no-signing / SmartScreen note.

### Repo

After `feat/simul` is merged to `main`:
`gh repo create jaycho1214/simul --public --source=. --remote=origin --push`,
then `pnpm release 0.1.0`, then `gh run watch` on the release workflow, fixing
and re-running until a release with the three Squirrel assets exists. Only
then is section 4 done.

---

## Order of work and gates

| Step | Gate to pass before the next |
| --- | --- |
| 0 | `pnpm format:check && pnpm typecheck && pnpm test` green; `main` fast-forwarded |
| 1 | `grep -ri tongyeok` empty; typecheck/tests green; `package` produces a runnable app |
| 2 | i18n parity test green; switch works live in `pnpm start` in both directions |
| 3 | reducer tests green; toast renders in dev with a simulated `ready` state |
| 4 | CI green on `main`; `v0.1.0` release exists with `RELEASES`, `.nupkg`, `Simul-Setup.exe` |
| — | Owner: Windows install + update round-trip (`v0.1.0` → `v0.1.1`) |

## Open items for the owner

- LICENSE: none until named.
- App icon for the installer and window: none supplied.
- Code signing: out of scope; revisit if SmartScreen becomes a problem at
  venues.
