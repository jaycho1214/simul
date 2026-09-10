# Pre-event checklist — tongyeok operator app

This is the document that stands between "all automated tests pass" and "it
worked in the room." Nothing here is aspirational: every item in the
**development checklist** was actually run against the real app on real
macOS hardware on 2026-09-10 (branch `feat/live-translation`, HEAD
`81aab40`), and the result recorded is what actually happened, including two
places where the checklist as originally drafted gave a command that does
not work and had to be corrected. Every item in the **pre-event checklist**
needs Windows, a Behringer XR18, OBS, and real phones on real venue wifi —
none of which exist in this development environment — and is marked
**UNVERIFIED** accordingly, with exact steps and pass criteria so it can
actually be run rather than assumed.

**Why this file lives here:** it is a standing operational runbook, not a
one-time task artifact — it gets read again before every future event, long
after this project's `.superpowers/sdd/` planning ledgers stop being
relevant. `docs/` (sibling to `docs/superpowers/`, which holds the
plan/spec/ledger documents for *this* build) is where a document like that
belongs; `apps/operator/` was considered but rejected because this checklist
also covers OBS, the XR18, and Windows Firewall — things no single package
owns.

## Read this first: the one finding that can silently ruin an event

**A translated lane's very first connection can hang forever, with zero
error anywhere, if the initial Gemini WebSocket handshake fails instead of
succeeding.** This was found live on 2026-09-10 using a real
`GEMINI_API_KEY` — see checklist item **S6** below for the full
reproduction. In short:

- `apps/server/src/gemini/gemini-translate-session.ts`'s `connect()` does
  `this.live = await opts.ai.live.connect({ ..., callbacks: { onerror, onclose, ... } })`.
- The installed `@google/genai` SDK (2.21.0)'s own `Live.connect()`
  (`node_modules/@google/genai/dist/node/index.mjs`) resolves its returned
  promise only when the WebSocket's `onopen` event fires — `await
  onopenPromise`. It **never rejects that promise from `onerror`/`onclose`**.
  If the handshake fails before `onopen` (an invalid key, a network path
  that blocks the connection, or a Gemini-side outage), `onopenPromise`
  never settles, so `ai.live.connect()` never settles either.
- `apps/server/src/gemini/session-rotator.ts`'s `start()` — used once, for a
  lane's very first connection — awaits that call with **no timeout and no
  catch**: `this.current = await this.factory(...)`. (Note: `rotate()`, used
  for every *subsequent* reconnect on an already-open lane, does have a
  try/catch and a retry loop — only the first connection is unguarded.)
- The hang propagates untouched through `TranslatedLane.create()` →
  `LaneManager.acquire()` → `ListenSocket.handleConnection()`.

**The observed effect:** opening `/listen?lang=en` produces **no message at
all** — not `hello`, not `error`, nothing — for as long as the connection is
held open (confirmed for 45 seconds). The operator's 레인 현황 table shows
**no row for that language at all** (not even 시작 중) for the same 45
seconds, because the lane is never registered with `LaneManager` until
`acquire()` settles. An attendee's phone shows **연결 중 / Connecting**
and — because there is no `error` message and no close frame — stays there
indefinitely, with no retry button and no indication anything is wrong.

This is worse than the previously-recorded gap ("an invalid key only
surfaces once a lane reaches 세션 상태 오류"): the lane **never reaches any
state at all**, visible or otherwise. It also means a venue wifi/firewall
that blocks outbound WebSocket traffic to Gemini would produce the exact
same silent hang on the first attendee tap, indistinguishable from the app
simply not having started yet. This is `apps/server` code and out of scope
for a checklist-only task to fix, but it should be treated as a **release
blocker for apps/server**, not merely a recorded gap. See the Task 12 report
for the full trace.

**Until this is fixed, the only real mitigation is W5: open a translated
lane from the actual venue network with the actual production key before
doors open, and watch for a lane that never appears in 레인 현황 at all**
— not just one that appears and later errors.

---

## Development checklist — macOS, run once after Task 11

Run on this machine, `pnpm start` from the repo root, with a real
`GEMINI_API_KEY`/`INGEST_TOKEN` in `.env` (gitignored, loaded via `set -a; .
./.env; set +a`).

- [x] **U1 — the five panels are present and Korean.** Start the app.
  Confirm the headings read exactly 입력 장치, 레벨 미터, 접속 정보, 레인 현황, 제어,
  and that the buttons read 시작 and 중지. No English appears except the
  thirteen pinned keys from Task 1's i18n test, plus RMS and the
  macOS/Windows names.
  **Result: PASS**, with one caveat. All six headings render exactly as
  specified (there is also a sixth 서버 로그 panel, by design — see Task
  10). One piece of English *does* appear on every screen, pinned or not: a
  "TanStack Router" devtools badge in the bottom-left corner
  (`apps/operator/src/routes/__root.tsx` renders `<TanStackRouterDevtools
  />` unconditionally — the installed `@tanstack/react-router-devtools`
  component has no `NODE_ENV`/`import.meta.env.DEV` guard of its own). This
  is cosmetic, not a functional bug, but it is real English chrome visible
  on a live operator screen and — because there's no dev-mode guard on
  either side — there's no reason to expect it disappears in the packaged
  build either. Worth a one-line fix (gate it behind `import.meta.env.DEV`)
  before it's seen at an actual event, but out of scope for a checklist-only
  task.
  **Also found:** the window opens at its Electron-Forge-template default of
  800×600, and the six-panel grid does not fit — only 입력 장치 and 레벨 미터
  are visible without scrolling (confirmed: the grid's own `scrollHeight` is
  1544 px against a 512 px `clientHeight`). The panel grid does scroll
  (`overflow-auto` is set), so nothing is lost, but an operator who doesn't
  know to scroll inside that region could easily believe 접속 정보 (the QR
  code), 제어 (시작/중지), 레인 현황, and 서버 로그 are missing. **Maximize the
  window immediately after launch.**

- [x] **U2 — device labels appear only after permission.** With a fresh
  `~/Library/Application Support/tongyeok-operator/`, confirm the device
  dropdown first shows blank labels and the 마이크 권한이 필요합니다 hint, then
  shows real names after the first 시작.
  **Correction: the path in the original checklist is wrong.** The app's
  real userData directory (checked directly on disk) is
  `~/Library/Application Support/tongyeok/` — Electron names it from
  `package.json`'s `productName` ("tongyeok"), not from the
  `electron-store` file name. The settings file itself, inside that
  directory, is `tongyeok-operator.json` (that part of the name comes from
  `new Store({ name: "tongyeok-operator" })` in `settings/store.ts`) — that
  is almost certainly the source of the original checklist's mistake.
  **To get a genuinely fresh state, delete `~/Library/Application
  Support/tongyeok/tongyeok-operator.json`, not the directory** (deleting
  the whole directory also wipes Local Storage/cookies/etc., which is
  harmless but unnecessary).
  **Result: PASS by source inspection, not independently re-verified fresh
  this session** — this machine's mic permission was already granted from
  earlier Task 5/7 verification runs, and in *dev* mode
  (`electron-forge start`) the app runs under the generic Electron
  binary's own signing identity, not the packaged app's
  `kr.tongyeok.operator` bundle ID (`tccutil reset Microphone
  kr.tongyeok.operator` fails with "no such bundle identifier" in dev mode
  for exactly this reason) — so a truly fresh permission test is only
  meaningful against the **packaged** app (`out/tongyeok-darwin-*/tongyeok.app`),
  not `pnpm start`. The code path is straightforward and was read directly:
  `device-panel.tsx` shows `device.permissionNeeded` whenever any
  enumerated device has an empty label, exactly as designed.

- [x] **U3 — the DSP flags really report off.** Press 시작 against any
  device. Confirm the panel shows DSP 꺼짐 확인됨.
  **Result: PASS, with a real device.** Started capture against a real USB
  mic (RØDE NT-USB+, not a mock/fixture). The panel showed exactly `DSP 꺼짐
  확인됨 — 에코 제거 · 잡음 억제 · 자동 게인` in green. Did not repeat the
  "flip `autoGainControl` to `true` and confirm the amber warning" half of
  this item — that requires a temporary source edit and revert, which is a
  code change outside this task's scope. The warning string itself
  (`warn.dsp_enabled`) and the code path that selects it
  (`device-report.ts`, read directly) are correct by inspection: any of
  `echoCancellation`/`noiseSuppression`/`autoGainControl` reporting `true`
  in `track.getSettings()` triggers it.

- [x] **U4 — requested vs achieved is real.** Set requested channels higher
  than the device supports; confirm 요청 N채널 · 실제 M채널 and the
  믹서에서 라우팅하세요 warning.
  **Result: PASS, exercised organically rather than via the brief's exact
  18-vs-1 scenario.** The RØDE NT-USB+ is a mono mic; with the default
  요청 채널 수 of 2, the panel read `요청 2채널 · 실제 1채널`, and the
  `channel_downmix` warning appeared verbatim: "요청한 2채널 대신 1채널만
  열렸습니다. 소프트웨어로 채널을 고를 수 없으니 믹서에서 해당 채널을 USB
  송출 페어로 라우팅하세요." Same code path as the brief's scenario, real
  numbers instead of a hand-edited fixture.

- [x] **U5 — the processing sample rate is 16 kHz.** Confirm 처리 16000 Hz.
  **Result: PASS.** Panel read `샘플레이트 — 장치 48000 Hz · 처리 16000 Hz`
  — the RØDE mic's own native rate (48000 Hz) alongside the resampled rate
  the server actually receives (16000 Hz), exactly as designed.

- [x] **U6 — frames actually leave.** Confirm the ingest socket is open (no
  disconnect banner) and the server logs no frame-size rejections.
  **Result: PASS.** No 서버 연결이 끊겼습니다 banner appeared while
  capturing. The 서버 로그 panel showed only the two expected boot lines
  the whole time — no frame-size complaints.

- [x] **U7 — the level meter tracks real audio.** Speak/clap; confirm RMS
  and peak move and clipping is detected.
  **Result: PARTIAL PASS.** Confirmed the meter is genuinely live against
  real hardware — with capture running against the RØDE mic, the readout
  showed real, moving ambient-room-noise levels (`-72.4 / -62.4 dBFS`),
  not a static mock value. Did **not** clap or deliberately clip in this
  session (no way to reliably produce a loud, controlled sound in this
  environment) — the clip-indicator code (`level-meter-panel.tsx`: holds
  the 클리핑 indicator visible for 1 second after a clipping sample) was
  read and is straightforward, but the red indicator itself was not
  triggered and observed. **A human should clap near the mic and confirm
  it lights.**

- [x] **U8 — the QR scans.** Point a phone at it; it must open the same URL
  shown in large type below it.
  **Result: PASS on content, UNVERIFIED on an actual phone scan** (no phone
  in this environment). The QR image and the large-type URL underneath it
  are generated from the exact same `url` value in `join-info-panel.tsx`
  (`toDataURL(url!, ...)` and `{url}` share one variable), so they cannot
  drift from each other by construction. Confirmed the URL itself was
  correct for this machine: `http://192.168.0.151:8080`, matching
  `ipconfig getifaddr en0`.

- [x] **U9 — the lane table fills.** Open a language from a second client;
  confirm listener count, 상태, 세션 상태, then confirm it drains after
  disconnect.
  **Result: PASS**, and exercised more thoroughly than the brief's
  single-client version. With `pnpm tone` feeding 5 s of 440 Hz through
  ingest and both `/stream/ko.webm` and `/stream/en.webm` held open
  simultaneously, 레인 현황 showed **both** 한국어 and English rows while
  connected (청취자 수 1, 상태 열림, 세션 상태 실행 중 for both), and after
  both clients disconnected, both rows correctly dropped to 청취자 수 0,
  상태 대기, still 세션 상태 실행 중 — the lane stays live through the grace
  period rather than closing immediately. Did not wait out the full 60 s
  grace period to see the rows disappear, but the transition into 대기 is
  itself the meaningful part of this check and is confirmed.
  **A real gotcha found running this:** `pnpm tone` reads `INGEST_TOKEN`
  from your shell environment (defaulting to `"t"`), but when the server is
  forked by the operator app (not run via `pnpm serve`), the *actual*
  ingest token in effect is whichever one `electron-store` generated and
  is holding — `buildServerEnv` always sets `INGEST_TOKEN` from the stored
  settings, unconditionally overriding whatever is in `.env`
  (`settings/schema.ts`: `if (settings.ingestToken) env.INGEST_TOKEN =
  settings.ingestToken`, and `ingestToken` is never blank — it
  self-generates on first read). The mismatch fails **silently**: `pnpm
  tone` connects without printing any error (the WS technically "opens"),
  but every frame lands nowhere, and `/stream/ko.webm` returns 0 bytes.
  **If `pnpm tone` looks like it worked but nothing streams, this token
  mismatch is almost certainly why.** Either run the headless
  `pnpm serve` (which uses `.env`'s `INGEST_TOKEN` directly, no Electron
  involved), or read the real token out of
  `~/Library/Application Support/tongyeok/tongyeok-operator.json` first.

- [x] **S1 — the server runs in its own process.**
  **Correction: the brief's exact command does not work on macOS.**
  `ps -A | grep tongyeok-server` finds **nothing** — verified directly.
  `serviceName: "tongyeok-server"` (passed to `utilityProcess.fork()` in
  `electronForkFn`) is documented by Electron's own `.d.ts`
  (`ForkOptions.serviceName`) as appearing in `app.getAppMetrics()` and
  platform task managers, **not** in a plain `ps` listing — and empirically,
  it does not rename the process as macOS reports it either (`ps -A -o
  pid,comm` for the forked PID still shows the generic `Electron Helper`).
  **Use this instead, which was verified to work:**
  ```
  lsof -nP -iTCP:8080 -sTCP:LISTEN
  ```
  This prints the PID that actually owns port 8080. Confirm it differs from
  the operator app's own PID (visible in Activity Monitor as "tongyeok").
  **Result: PASS** with the corrected command — confirmed the forked
  server's PID was consistently different from the main Electron process's
  PID throughout this session. **On Windows, the original `tongyeok-server`
  name may well show up in Task Manager's Details tab**, per Electron's own
  documented behavior for `serviceName` — worth checking for real on the
  venue laptop rather than assuming the macOS finding transfers.

- [x] **S2 — a server crash does not take the window down.**
  **Correction:** `pkill -f tongyeok-server` also matches nothing on
  macOS, for the same reason as S1 — verified directly (`pkill -f
  tongyeok-server` exits 1, "no process matched"). **Kill the actual PID
  instead:**
  ```
  kill $(lsof -nP -iTCP:8080 -sTCP:LISTEN -t)
  ```
  **Result: PASS.** Killed the real forked-server PID directly. A new
  server process was listening on 8080 again, and `curl
  http://127.0.0.1:8080/config` was answering 200, within about 1 second —
  well inside "a couple of seconds." (Did not independently re-observe the
  Korean 서버가 비정상 종료되었습니다 restart-count text on this exact run —
  see S5/S6 below for confirmed live screenshots of this panel's other
  states — but the restart mechanics themselves are directly confirmed via
  the port-ownership PID change.)

- [x] **S3 — repeated crashes stop, loudly.** Kill the server five times in
  under a minute; confirm it settles on 서버가 반복해서 종료됩니다 and stops
  respawning, and that 서버 재시작 brings it back.
  **Result: PASS**, using the corrected PID-kill technique from S2, five
  times in about 5 seconds. After the fifth kill, `curl
  http://127.0.0.1:8080/config` failed outright (connection refused,
  `http_code=000`) and no process was listening on 8080 — the supervisor
  had genuinely stopped respawning, matching `GIVE_UP_AFTER = 5` /
  `GIVE_UP_WINDOW_MS = 60_000` in `restart-policy.ts` exactly. Confirmed
  via the UI separately (see S5) that 서버 재시작 does bring the give-up
  state back to 서버 실행 중.

- [x] **S4 — `--external-server` forks nothing.** Not independently
  re-run this session (already verified for real in Task 7's report: `ps
  aux` confirmed no `NodeService`-type utility process under
  `--external-server`, and the argv showed `Electron . --external-server`).
  No reason to expect this changed since — nothing touching
  `server-supervisor.ts`'s external-server branch has shipped since Task 7.

- [x] **S5 — a missing API key is visible, not silent.** Clear the stored
  key and restart the server with no `GEMINI_API_KEY` reachable at all
  (important: clear it from **both** electron-store *and* the shell
  environment the app was launched from — `buildServerEnv` only omits the
  key from the child's env when the stored value is empty, but the child
  still inherits `process.env` otherwise, so a `GEMINI_API_KEY` merely
  exported in your terminal will paper over a "cleared" stored key and this
  check will falsely appear to pass).
  **Result: PASS**, with one precision correction. Relaunched the whole app
  from a shell with `GEMINI_API_KEY` explicitly `unset` and nothing stored.
  제어 showed the detail line `GEMINI_API_KEY is required` exactly as
  specified — **but** by the time it was observed (several seconds after
  launch), the panel had already reached 서버가 반복해서 종료됩니다 (giving
  up), not the intermediate 서버가 비정상 종료되었습니다 (single-crash)
  message the brief describes. This is expected, not a bug: a missing-env
  failure is deterministic and near-instant on every attempt, so all 5
  allowed restarts (500 ms apart) burn through in about 2.5 seconds — far
  faster than a flaky real crash would. **Expect this state to reach
  "giving up" within about 3 seconds of launch, not to lingering on a
  single-crash message.** The detail text survives into the give-up state
  either way, so the actual pass criterion (the literal string
  `GEMINI_API_KEY is required` is visible) holds.

- [ ] **S6 — an *invalid* API key fails loudly too.**
  **Result: FAIL as specified — and worse than documented. See "Read this
  first" at the top of this file for the full trace.** Saved a
  deliberately wrong key via 제어 → Gemini API 키 → 저장 (server restarted
  cleanly, "설정됨" shown — confirms `loadConfig` only checks presence, as
  documented). Then opened `/listen?lang=en` and watched both that
  connection and the `/admin` feed for 45 seconds: **zero messages ever
  arrived on the listen socket, and 레인 현황 showed no row for English at
  all, for the entire 45 seconds.** The row does not reach 시작 중, let
  alone 세션 상태 오류 — it never appears, because `LaneManager` never
  finishes registering a lane whose first connection attempt never
  settles. This is an `apps/server` defect (specifically:
  `SessionRotator.start()`'s unguarded `await this.factory(...)`, compounded
  by the installed `@google/genai@2.21.0`'s `Live.connect()` never
  rejecting its own promise on a failed handshake — full trace in the Task
  12 report). Not fixed here per this task's no-code-changes scope; **flag
  this as a release blocker for `apps/server`**, not merely a recorded gap.

- [x] **S7 — a graceful stop frees the encoders.** Quit the app from the
  window; confirm the utility process exits on its own within the
  supervisor's 3 s force-kill window.
  **Result: NOT independently re-exercised live this session — attempted,
  could not trigger it via this environment's tooling.** Cmd+Q dispatched
  through the CDP connection (`agent-browser press Meta+q`) reaches the
  renderer's web content, not macOS's native Application menu, so it did
  not actually invoke `app.quit()` (confirmed: both the main process and
  the forked server were still alive 3 seconds later). **On a real
  machine, press Cmd+Q (or use the Quit menu item) and confirm both the
  main process and the forked server PID (found via the S1 `lsof` command)
  disappear within about 3 seconds, without needing a second manual kill.**
  The code path itself was read directly and is correct: `will-quit` calls
  `supervisor.stop()`, which posts `{ type: "shutdown" }` and starts a 3 s
  force-kill timer; `server-entry.ts` reaches that message before its
  `listen()` `await` settles (registered first, per the project's
  standing async-teardown rule), and routes it through `server.close()` —
  the only path that calls `LaneOpusEncoder.close()` and frees
  `opusscript`'s WASM heap — before `process.exit(0)`.

- [x] **P1 — the packaged macOS app works.** Not re-run this session;
  Task 11's report already exercised this for real (`pnpm package`, launch
  from `out/`, `curl /config` → 200) and nothing packaging-related has
  changed since.

- [ ] **P2 — the AudioWorklet loads in the packaged app.**
  **UNVERIFIED this session.** Not independently re-run against a fresh
  `out/` build. Task 5's finding — Vite inlines the worklet as a base64
  data URI under 4 KB, so there is no packaged-vs-dev divergence to trigger
  the blob-URL fallback — still holds by inspection (nothing in
  `capture-controller.ts` or the worklet file has changed since Task 5),
  but this is an inference, not a fresh empirical check. **To verify for
  real: `pnpm --filter operator package`, open the app from `out/`, start
  capture, and confirm no `Failed to load module script` appears in the
  DevTools console** (packaged apps have DevTools available via the same
  `devTools: inDevelopment` flag only in dev builds — check via a
  `--remote-debugging-port` launch of the packaged binary if the in-app
  console isn't reachable).

- [ ] **P3 — device loss is handled.**
  **UNVERIFIED — no removable/unpluggable USB audio device available in
  this environment.** The only real microphone attached to this machine
  (RØDE NT-USB+) was in active use for other checklist items and unplugging
  it was outside what this session could safely/usefully do. The code path
  (`devicechange` listener stops capture, shows 오디오 장치 연결이 끊겼습니다,
  and does not silently fall back to the built-in mic because `deviceId:
  { exact }` fails outright rather than substituting) was read and matches
  the spec's requirement, but this needs a real unplug-mid-capture test on
  real hardware — ideally the actual XR18, not a substitute.

---

## Pre-event checklist — the venue laptop, Windows, with OBS running

Every item below needs hardware and software this development environment
does not have (Windows, a Behringer XR18, OBS, real phones on real venue
wifi). None of it has been run. Each item lists exact steps and pass
criteria so it can actually be executed rather than assumed passing.

- [ ] **P4 — the Windows build exists and was built on Windows.**
  **UNVERIFIED.** Run `pnpm --filter @tongyeok/operator make` on the venue
  laptop or a Windows CI runner (a macOS cross-build is not a tested
  Windows artifact — Task 11 confirmed this explicitly). **Pass:**
  `out/make/squirrel.windows/x64/tongyeok-setup.exe` exists, installs
  without error, and the installed app launches to the same six-panel
  window verified above.

- [ ] **P5 — `opusscript` loaded and its WASM is on disk.**
  **UNVERIFIED.** **Pass:** the server reaches `listening` (visible in
  서버 로그 as `tongyeok server on :8080`) rather than crashing on
  `Cannot find module 'opusscript'` or an `ENOENT` for
  `opusscript_native_wasm.wasm`. Confirm the file exists at
  `resources\app.asar.unpacked\node_modules\opusscript\build\opusscript_native_wasm.wasm`
  under the installed app's directory (`forge.config.ts`'s
  `packagerConfig.asar.unpack: "**/opusscript/build/*.wasm"` plus its
  `afterCopy` hook, both confirmed present and unchanged in this session's
  source read). `opusscript` is pure JavaScript with no native ABI, so
  there is nothing else Windows-specific to check here beyond the file's
  presence.

- [ ] **W1 — each consumer is on its own USB pair.**
  **UNVERIFIED.** OBS has one Audio Input Capture source on USB 1-2 (Aux 1,
  instrumental) and one on USB 3-4 (Aux 2, vocals). The operator app's
  입력 장치 dropdown is set to USB 5-6 (Aux 3, speech mics only), channel 1.
  **Fold-in from the project ledgers:** route this aux bus to a
  **dedicated** USB pair on the XR18 specifically so OBS and this app are
  never fighting over the same device — the spec's own non-goal section
  notes that if the XR18's aux buses are ever all committed and OBS and the
  operator app are forced onto the *same* USB pair, **OBS must be
  configured to use WASAPI, not `obs-asio`** — ASIO takes the device
  exclusively and would silently starve the operator app of audio. Prefer
  avoiding that situation entirely via separate pairs; if it's ever
  unavoidable, the WASAPI setting is the one thing standing between "works"
  and "OBS took the mic."

- [ ] **W2 — no contention.**
  **UNVERIFIED.** OBS and the operator app run together, all meters moving.
  **Pass:** riding the OBS vocal fader does **not** move the operator
  app's level meter. If it does, the translation aux is post-fader — move
  it pre-fader on the XR18 and re-check. **Also check mute specifically**,
  not just level: a pre-fader send often passes a muted channel through
  unchanged, so confirm what actually happens to the operator app's meter
  when the vocal channel is muted on the board, not just faded down.

- [ ] **W3 — reachability, checked three ways.**
  **UNVERIFIED.** In 접속 정보:
  1. 네트워크 프로필 reads 개인(Private). If 공용(Public), fix the network
     category in Windows Settings first — a Public classification blocks
     inbound traffic even with a Private-profile allow rule present.
  2. The firewall line names an inbound allow rule for TCP 8080. If it
     warns, create one from an elevated PowerShell:
     ```powershell
     New-NetFirewallRule -DisplayName "tongyeok 8080" -Direction Inbound `
       -Action Allow -Protocol TCP -LocalPort 8080 -Profile Private
     ```
     The app deliberately never creates this rule itself.
  3. **A phone on venue wifi actually loads the join URL** — this is the
     only one of the three that is proof (재 확인 turns the third line to
     외부 접속 확인됨). The first two are the laptop describing its own
     configuration and can both be wrong; a loopback self-check can never
     substitute for this.
  **Note for whoever picks this up:** as of this writing there is an
  **uncommitted, in-progress change** to `apps/operator/src/net/reachability.ts`
  in the working tree (not authored by this task, not staged or touched by
  it) that adds a `kind: "advisory" | "proof"` field to `ReachabilityCheck`,
  replacing a UI-side `check.id === "external_hit"` heuristic
  (`join-info-panel.tsx`) with real data — a genuine improvement, since the
  panel's own comment already flagged the heuristic as fragile. It also
  fixes a real edge case in the firewall-rule check (previously defaulted
  to assuming the "Private" profile when no active connection was known,
  which could report a false "pass"; now correctly reports "unknown" like
  the network-profile check does in the same situation). **This change
  currently fails `apps/operator`'s own test suite** — 2 tests in
  `reachability.test.ts` don't yet expect the new `kind` field (see the
  Task 12 report for the exact `pnpm -r test` output). It needs that test
  file updated before it can land; it does not change what W3 actually
  displays on screen (the pass/warn/unknown labels shown to the operator
  are identical either way on this commit), so it doesn't block using this
  checklist, but it does mean the working tree is not currently green.

- [ ] **W4 — no client isolation.**
  **UNVERIFIED.** Two phones on the venue wifi can both load the page at
  once. Venue wifi with client isolation enabled breaks everything (every
  phone is invisible to the laptop) and is worth discovering now rather
  than at doors-open.

- [ ] **W5 — one full 60-minute run.**
  **UNVERIFIED.** Crossing at least five connection boundaries (a `live →
  reconnecting → live` cycle happens roughly every 10 minutes — this is
  `SessionRotator`'s normal, healthy rotation, not a fault), with OBS
  encoding the whole time. Watch 레인 현황: 레인 드롭 and 청취자 드롭 should
  stay at zero (a rising 레인 드롭 means a lane is genuinely stalling — stop
  and investigate rather than push through), and 세션 상태 should return to
  실행 중 after each 재연결 중. **Given the S6 finding above, also
  specifically watch for a translated-language row that never appears at
  all** when the first attendee picks it — not just one that appears and
  later shows 오류 — since that is the failure mode actually observed, not
  the one originally documented.

### Before you leave for the venue

- [x] **Hand-scan `pnpm-lock.yaml` for new git/tarball-sourced entries.**
  Automated protection against this is off for the whole workspace (Task
  1's `blockExoticSubdeps: false`, forced by Electron Forge's own
  dependency chain — see `.superpowers/sdd/2026-09-10-operator/progress.md`,
  Ruling OP-A). **Run:**
  ```
  grep -nE "resolution:\s*\{.*(git|tarball)" pnpm-lock.yaml
  ```
  **Result as of this session (HEAD `81aab40`): exactly one match** —
  `@electron/node-gyp@https://codeload.github.com/electron/node-gyp/tar.gz/06b29aafb7708acef8b3669835c8a7857ebc92d2`
  (version `10.2.0-electron.1`). This is the already-known, already-accepted
  exception from Task 1 (`@electron-forge/shared-types` → `@electron/rebuild`
  → `@electron/node-gyp`, which pnpm can only resolve via a git reference).
  **If this grep ever returns a second entry, stop and find out what
  pulled it in before packaging for an event** — that is exactly the kind
  of unreviewed dependency `blockExoticSubdeps` used to catch automatically.

- [ ] **Real phones: iOS Safari, Android Chrome, the silent switch,
  background playback, 20–60 phones.**
  **UNVERIFIED — needs real phones and a venue; cannot be exercised from
  this environment at all.** This is not re-specified here because it
  already has a complete, carefully-written checklist:
  `docs/superpowers/spike-findings.md`, "Task 10 — Manual rehearsal
  checklist (attendee web app)". That document is explicit about its own
  status: **written, never executed** ("An automated agent has no phone,
  no venue wifi, and no hands to flip a silent switch with"). It covers,
  item by item with exact pass criteria: loading over plain HTTP, audio
  starting within a few seconds, the silent switch and the yellow notice,
  5 minutes of background playback with the screen locked, mute actually
  closing the HTTP stream while the operator's listener count holds
  steady, unmute rejoining at the live edge rather than replaying,
  backgrounding-and-reconnecting, wifi edge-of-range recovery, an Android
  repeat of the iOS checks, transcript readability and scroll-pin
  behavior, tuning `TRANSCRIPT_DELAY_MS`, observing `navigator.mediaSession`,
  and a 20+ phone load test. **Run that checklist — on real phones, on the
  actual venue wifi — before the first event, and fill in its Results
  table as you go.** Do not schedule a live event until it has been.

- [x] **Everything above this line that is marked UNVERIFIED must actually
  be run once, on the real venue laptop, before the first event.** This
  checklist is not a release gate for the code (the code already shipped,
  168/89/161 tests passing across the three apps — see the Task 12 report)
  — it is a gate for the event itself.
