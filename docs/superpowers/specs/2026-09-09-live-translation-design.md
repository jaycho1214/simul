# 실시간 통역 시스템 — Design

**Date:** 2026-09-09
**Status:** Approved, pending spikes

## Purpose

Real-time speech translation for in-person events. A speaker talks in Korean;
attendees on venue wifi open a web page on their phones, pick a language, and
listen to a translation while reading its transcript.

Everything runs on the venue LAN. Only the operator machine needs internet, to
reach the Gemini API.

## Constraints

These shaped the design and should be re-read before changing it.

**One session per language.** `translationConfig.targetLanguageCode` is
singular. N languages means N concurrent Gemini sessions fed identical audio.
Cost scales linearly with language count, not listener count.

**No secure context.** Attendees load `http://192.168.x.x:8080`. That rules out
`RTCPeerConnection`, WebCodecs `AudioDecoder`, `AudioWorklet`, and the Wake Lock
API. `AudioContext`, `AudioBufferSourceNode`, `<audio>`, WebAssembly and `ws://`
are all available.

**Audio formats are fixed by the API.** Input is 16-bit PCM mono @ 16 kHz.
Output is 16-bit PCM @ 24 kHz.

**Connections die every ~10 minutes** regardless of session length. See
"Session management".

**Scale target:** 20–60 concurrent phones, 2–5 concurrent languages.

## Architecture

```
┌──────────────────────────────┐
│  Operator App  (Tauri + Rust)│  venue laptop, has internet
│  device picker · level meter │
│  lane dashboard · join QR    │
│  supervises server sidecar   │
└──────────────┬───────────────┘
               │  ws://localhost:8080/ingest
               │  16 kHz mono s16le, 20 ms frames (640 B)
               ▼
┌──────────────────────────────────────────────────────┐
│  Server  (Node + TS)          holds GEMINI_API_KEY   │
│                                                      │
│  IngestGateway ──► AudioHub ──┬─► Lane "ko" (source) │  passthrough, no API
│                               │      └─► Opus 16k    │
│                               ├─► Lane "es" ─────────┼─► Gemini session
│                               │      └─► Opus 24k    │
│                               └─► Lane "ja" ─────────┼─► Gemini session
│                                      └─► Opus 24k    │
│                                                      │
│  SubscriptionRegistry — refcount per lane            │
│  FrameBus per lane → WebMSink  (│ WsSink later)      │
│  TranscriptBus + rolling history (200 lines)         │
│  Serves the attendee SPA statically                  │
└──────────┬───────────────────────┬───────────────────┘
           │ ws://…/listen?lang=es │ GET /stream/es.webm
           │ transcript + state    │ chunked audio
           ▼                       ▼
                  20–60 attendee phones
```

Three deployables, one pnpm workspace, TypeScript throughout except the Rust
capture layer.

## Components

### Operator app — `apps/operator` (Tauri v2, Korean UI)

Audio capture is native Rust, deliberately. Capturing through `getUserMedia`
would subject a line-level program feed to the webview's `echoCancellation`,
`noiseSuppression` and `autoGainControl`, which pump and smear program audio.

Rust side:
- `cpal` — device enumeration and capture, including channel selection on
  multi-channel interfaces
- `rubato` — sinc resample to 16 kHz mono, then i16
- `tokio-tungstenite` — WS client to the server
- Capture thread computes RMS + peak, `app.emit("level", …)` at 20 Hz
- State via `app.manage(Mutex<CaptureState>)`; commands `list_input_devices`,
  `start_capture`, `stop_capture`
- Settings persisted with `tauri-plugin-store`

Frontend (React + TS), single window, all labels Korean:

| Panel | Contents |
|---|---|
| 입력 장치 | Device dropdown, channel picker, detected sample rate |
| 레벨 미터 | RMS + peak, clipping indicator |
| 접속 정보 | Large QR of `http://<lan-ip>:8080` + the URL in large type; auto-detected IP, dropdown if several interfaces |
| 레인 현황 | Per lane: 언어 · 청취자 수 · 상태 · 드롭 프레임 · 세션 상태 |
| 제어 | 시작 / 중지, server connection status |

The Node server ships as a **Tauri sidecar** the app spawns and supervises: one
icon starts everything, quitting stops it. `--external-server` skips it for
development.

### Server — `apps/server` (Node + TS)

**IngestGateway** — `/ingest`, single client, shared-secret token in the query
string. A reconnecting operator app takes over; the stale socket is closed.
Validates frame size.

**AudioHub** — pure fan-out to open lanes. Each lane has a bounded queue; a
stalled lane drops its oldest frames and increments a counter. One sick lane
can never stall ingest or another lane. No replay buffer — a cold lane starts
from now.

**Lane** — one per active language:
- `SourceLane` (Korean): ingest PCM 16k → Opus → FrameBus. No API call, no cost,
  no transcript in v1.
- `TranslatedLane`: `SessionRotator` → 24 kHz PCM → Opus → FrameBus, and
  `outputTranscription` → TranscriptBus.

**Opus encoding happens once per lane** and the resulting buffer is shared by
every subscriber. VOIP mode, ~24 kbps mono, 20 ms frames. If bundling the native
`@discordjs/opus` addon into a single-file sidecar binary proves painful, a WASM
encoder is an acceptable substitute — 5 lanes at 24 kbps is nowhere near a
bottleneck.

**WebMSink** — muxes existing Opus frames into a chunked WebM stream. This is
packaging, not re-encoding. Each new HTTP connection receives the init segment
(EBML header, Segment, Tracks with `OpusHead` codec private data) followed by
clusters from the live edge.

**SubscriptionRegistry** — `Map<lang, Set<client>>`, keyed on the **WS**
connection, not the audio stream, so a muted reader keeps their lane alive.
0→1 opens a lane and cancels any pending close; 1→0 starts a **60 s grace
timer** before teardown. `maxConcurrentLanes` (default 6) bounds worst-case
spend.

**TranscriptBus + history** — rolling last 200 lines per lane. Serves late
joiners recent context instead of a blank screen, and lets a backgrounded phone
catch up after the browser suspends its socket.

**Backpressure** — applies to the HTTP audio stream, not the WS, which now
carries only text. If a response stream's `writableLength` passes ~64 KB
(≈2.5 s of Opus), drop frames for that connection rather than buffer. A phone in
a dead spot must not grow server memory. This is a different counter from the
AudioHub lane-queue drop; the dashboard shows both, as 레인 드롭 and 청취자 드롭.

### Attendee web app — `apps/web` (plain HTTP, bilingual KO/EN)

**Entry screen** is a language-neutral picker — one large row per lane, each
endonym in its own script:

```
한국어  (원음 · Original)
English
Español
日本語
```

The tap that picks a language also satisfies iOS's user-gesture requirement for
audio. There is no auto-start path.

**One mode only:** audio and transcript together.

- Audio is an `<audio src="/stream/es.webm">` element. Decode, jitter buffering
  and loss concealment all live in the OS media stack — no WASM, no scheduler,
  no jitter buffer in our code, and it works on old hardware.
- **음소거 / Mute** pauses the element, which stops the HTTP stream entirely, so
  a reader costs no audio bandwidth. Unmute re-requests with a cache-buster to
  rejoin the live edge rather than resuming a stale buffer.
- **Background playback is free.** Phone in pocket, screen off, headphones in.
  This is why no wake lock is needed.
- Transcript: rolling list, newest at bottom, sticky-scroll that releases if the
  reader scrolls up. Interim transcription renders lighter and commits on final.
  Large high-contrast type — read at arm's length in a dim room. DOM capped at
  ~50 visible lines.

All chrome is Korean + English together. One string table, no per-language
locales.

**Sync:** the transcript will run ahead of the audio by roughly the `<audio>`
buffer depth. v1 ships a configurable fixed delay, tuned after the latency
spike and a rehearsal. A hold-and-release buffer is a small change to add later
if the fixed value proves inadequate.

## Wire protocols

**Ingest** — `ws://localhost:8080/ingest?token=…`, binary only, 640-byte frames
of 16 kHz mono s16le.

**Listen** — `ws://<host>:8080/listen?lang=xx`, text JSON only:

| Direction | Message |
|---|---|
| → client | `{type:"hello", lang, historyLines}` |
| → client | `{type:"history", lines:[…]}` on connect |
| → client | `{type:"transcript", text, isFinal, seq, ts}` |
| → client | `{type:"lane", state:"starting"\|"live"\|"reconnecting"\|"error"}` |

**Audio** — `GET /stream/<lang>.webm`, chunked transfer, indefinite.

**Admin** — `ws://localhost:8080/admin`, lane table snapshots for the operator
dashboard.

## Session management (Gemini)

Lane config:

```js
{
  responseModalities: ["AUDIO"],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  translationConfig: { targetLanguageCode: "es", echoTargetLanguage: false },
  contextWindowCompression: { slidingWindow: {} },
  sessionResumption: {}
}
```

Three separate mechanisms, each solving a different problem:

- **`contextWindowCompression`** removes the 15-minute audio-only session cap.
  That cap is a context-window artifact: audio runs ~32 tokens/second, so 15
  minutes ≈ 28.8k tokens against a 32k limit. A sliding window lets sessions run
  indefinitely. Dropping old context costs nothing here — translation is
  effectively stateless per utterance.
- **`sessionResumption`** survives connection death. Connections last only
  ~10 minutes regardless of session length. The server emits
  `SessionResumptionUpdate` messages carrying handles; store the latest and
  reconnect with `SessionResumptionConfig.handle`. Session state survives, so
  terminology stays consistent across the seam. Handles are valid 2 hours.
- **`GoAway`** gives advance warning with a `timeLeft` field, so rotation is
  driven by a real signal rather than a guessed timer.

**`SessionRotator`** holds the latest resumption handle. On `GoAway`, it opens a
replacement connection using that handle, waits for its first audio, cuts over
the FrameBus, and closes the old connection. Make-before-break, so listeners
hear no gap.

If spike 1 shows a naive reconnect produces a sub-second seam, delete
`SessionRotator` and just reconnect. Simpler is better here.

## Failure handling

| Failure | Response |
|---|---|
| Gemini session drops | Reconnect with backoff and stored handle; lane state → `reconnecting`; phones show "재연결 중 / Reconnecting"; audio stream stays open and goes silent rather than 404ing |
| Connection lifetime reached | `SessionRotator` via `GoAway` |
| Operator app loses server | Auto-reconnect; capture keeps running so the level meter still moves; dashboard shows disconnected |
| Audio interface unplugged | `cpal` device-lost → stop capture, surface a Korean error, offer re-pick. Never silently fall back to the built-in mic |
| Attendee wifi drops | `<audio>` stalls; client detects and re-requests at live edge |
| Lane cap reached | "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now" |
| API key invalid or quota exhausted | Fail loudly on the operator dashboard, not silently per lane |

## Testing

- **`FakeTranslateSession`** echoes input as 24 kHz PCM with synthetic
  transcripts. Makes lanes, refcounting, rotation, history and backpressure
  deterministic. Zero API spend in CI.
- Fake clock for rotation and grace timers.
- Golden test: WAV in → WebM out, remux and compare RMS.
- Rust: resampler against a known sine sweep, asserting 48k→16k is clean.
- Manual rehearsal checklist: real interface, real phones on both platforms, one
  full 60-minute run crossing at least five connection boundaries.

## Spikes — run before writing production code

Each answers a question that changes what gets built.

1. **Session continuity.** Do `contextWindowCompression` and `sessionResumption`
   get accepted by `gemini-3.5-live-translate-preview` specifically? Preview
   models sometimes reject config the general docs advertise. Observe one full
   `GoAway` → reconnect cycle with continuous output. If a naive reconnect seams
   under a second, `SessionRotator` is unnecessary.
2. **End-to-end latency.** Speak, stopwatch to translated audio. This number
   decides whether the deferred low-latency WS audio path is ever worth
   building, and sets the transcript delay default.
3. **`<audio>` chunked WebM/Opus playback** on iOS Safari and Android Chrome,
   including a late joiner receiving the init segment then clusters from the
   live edge. If iOS balks, fall back to a CAF container for Safari.

## Non-goals for v1

Each has a seam. None gets built now.

- **OBS output** — deferred by the user. Attaches at `TranscriptBus`.
- **HTTPS / WebRTC** — would restore Wake Lock, WebCodecs and better jitter
  handling, and would make iOS ignore the silent switch. Requires a real domain
  whose A record points at the venue LAN IP, certified via DNS-01. Attaches at
  the FrameBus sink abstraction. Revisit if a rehearsal shows HTTP hurting.
- **Attendee mobile app** — Tauri v2 targets iOS and Android, which would give
  native decode and native audio sessions. Blocked by distribution, not
  technology: walk-in attendees scan QR codes, they do not install apps. Viable
  only for a recurring audience.
- Low-latency WS audio path — pending spike 2.
- AAC-ADTS path for pre-18.4 iOS — needs a real encoder; build only if those
  devices actually show up.
- Recording, archive, transcript export.
- Speaker switching language mid-event.
- Attendee authentication beyond being on the LAN.
- Source-language transcript (would require a dedicated session).

## Known rough edges

- **iOS silent switch mutes Web Audio and `<audio>`.** An attendee with the
  physical mute switch on hears nothing and will assume the system is broken.
  Mitigated by an unmissable bilingual notice on the listen screen. Only HTTPS +
  WebRTC removes this properly.
- `navigator.mediaSession` may be secure-context-only. If so, the OS still shows
  generic transport controls for the `<audio>` element — cosmetic loss only.
  Verify rather than assume.
- Venue wifi with client isolation would break everything. Check before the
  event.

## Configuration

| Key | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | Server only, never sent to clients |
| `INGEST_TOKEN` | — | Shared secret for `/ingest` |
| `PORT` | 8080 | |
| `SOURCE_LANGUAGE` | `ko` | Passthrough lane, no API cost |
| `OFFERED_LANGUAGES` | `["ko","en","es","ja"]` | Shown on the picker |
| `MAX_CONCURRENT_LANES` | 6 | Bounds worst-case spend |
| `LANE_GRACE_MS` | 60000 | Delay before teardown at refcount 0 |
| `TRANSCRIPT_HISTORY_LINES` | 200 | Per lane |
| `TRANSCRIPT_DELAY_MS` | 0 | Tune after spike 2 |
| `OPUS_BITRATE` | 24000 | Per lane |
