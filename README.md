# Simul

Live speech-to-speech translation for a room. One laptop at the mixer captures
the house audio and sends it to Gemini Live; each person in the room opens a
page on their phone over the venue's own network, picks a language, and hears
the translation — with a live transcript — a few seconds behind the speaker.

Built for church services and small conferences: no cloud deployment, no
accounts, no app to install on phones. The operator installs one Windows app,
enters a Gemini API key, chooses the audio input, and shows a QR code.

## How it fits together

```
 mixer ──USB──▶ Simul operator app (Electron, Windows) ──▶ Gemini Live API
                     │  hosts the translation server              │
                     │  on the laptop's LAN address               ▼
                     └──▶ phones on the venue wifi ◀── translated audio
                                                       + transcript per language
```

| Package             | What it is                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/operator`     | The Electron app the sound engineer runs: audio capture from the mixer, device and level checks with an input gain trim and a measured-room noise reducer, join QR code, lane status, an estimated API cost meter, event branding, server log. Korean or English UI. |
| `apps/server`       | The Node translation server: one Gemini Live session per offered language, Opus/WebM streams and transcripts to phones, an admin feed for the operator app. Runs inside the operator app, or headless with `pnpm serve`.                                             |
| `apps/web`          | The attendee page phones open: language picker, play/mute, live transcript, the event's brand.                                                                                                                                                                       |
| `packages/protocol` | The wire types the three share.                                                                                                                                                                                                                                      |

## Requirements

- Node.js ≥ 23.6 and pnpm 11 (`corepack enable` picks the pinned version up).
- A Google Gemini API key with access to the live translation model.
- For an event: a Windows laptop with a USB audio interface or mixer, and a
  wifi network phones can join. See the [pre-event checklist](docs/pre-event-checklist.md)
  for the full run-book, including the Windows firewall rule and how the
  XR18 is shared with OBS on Windows and on macOS.

## Run it

```bash
pnpm install
pnpm start          # builds the attendee page and opens the operator app
```

The API key, the port, the offered languages and everything else about the
event are set inside the app (제어 / Control panel) and stored in the app's
own settings; `.env` is not read by the app. Leave the speaker's own language
out of the offered list: a lane in it repeats the speaker untranslated at the
same cost as any other. Adding a language applies at once — phones on the
picker see it within seconds — while removing one waits for the next server
restart so nobody mid-lane is cut off; the 언어 panel shows which removals
are still pending. 제어 also shows a running estimate of the Gemini
cost since the server started — the API cannot report a key's real spend,
so the panel links to the AI Studio usage dashboard for that.

Headless, for developing the attendee page without the Electron window:

```bash
cp .env.example .env   # GEMINI_API_KEY, INGEST_TOKEN, …
pnpm serve             # server on :8080 serving apps/web/dist
pnpm tone              # feeds a test tone into it
```

## Develop

```bash
pnpm test           # every package
pnpm typecheck
pnpm format         # prettier --write; CI runs format:check
```

Useful switches:

- `pnpm --filter @simul/operator start:external` — the app attaches to a
  server you started yourself (`pnpm --filter @simul/server dev`).
- `SIMUL_FAKE_UPDATE=1 pnpm start` — walks the update toast through its
  states without a Windows machine or a published release.

## Release and update

Installed apps update themselves: the Windows build checks GitHub Releases on
launch and hourly, downloads a newer version in the background, and shows a
toast — the engineer restarts when the room allows. Nothing interrupts a
service. Settings — the API key, languages, brand, device choice, UI
language — live in `%APPDATA%\Simul` (Electron's `userData`), outside the
program folder the update replaces, so they survive updates and reinstalls.

To publish a version:

```bash
pnpm release 0.2.0
```

That bumps `apps/operator/package.json`, commits, tags `v0.2.0` and pushes.
GitHub Actions (`.github/workflows/release.yml`) then runs the tests, builds
the Windows installer with Electron Forge and publishes `Simul-Setup.exe`,
the Squirrel `.nupkg` and `RELEASES` to the release — the files
[update.electronjs.org](https://update.electronjs.org) serves to installed
apps. The workflow refuses a tag that does not match the package version.

The installer is not code-signed; Windows SmartScreen shows a warning on the
first install of each version ("More info → Run anyway"). Updates after that
install silently.

## Status

`docs/superpowers/` holds the design specs and implementation plans this was
built from, and `docs/pre-event-checklist.md` records what has and has not
been verified on real hardware.
