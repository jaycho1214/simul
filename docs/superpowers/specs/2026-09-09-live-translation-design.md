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

**The venue rig is a Behringer XR18** — an 18-in/18-out USB interface, not a
stereo one. This is platform-asymmetric and constrains capture:

- macOS: class-compliant, all 18 channels visible to Core Audio, no driver.
- Windows: the WDM driver exposes only **USB 1-2, 3-4, 5-6, 7-8 and 1-8** as
  separate devices. All 18 channels need **ASIO**, which Chromium does not
  support and stock ffmpeg is not built against.

Neither `getUserMedia` nor ffmpeg can therefore reach channels 9–18 on Windows.
See "Operator app" for how channel selection is handled within that limit.

## Architecture

```
┌──────────────────────────────┐
│  Operator App  (Electron)    │  venue laptop, has internet
│  device picker · level meter │
│  lane dashboard · join QR    │
│  hosts the server process    │
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

Three deployables, one pnpm workspace, TypeScript throughout. The server runs
inside the operator app's Electron process tree, so it is a deployable in the
architectural sense, not a separately installed one.

## Components

### Operator app — `apps/operator` (Electron, Korean UI)

Built from the **`electron-shadcn`** template: Electron Forge + Vite + React +
TypeScript, with shadcn/ui, Tailwind, TanStack Router, typed oRPC IPC, and
i18next already wired. The i18next setup carries the Korean UI directly.

Capture runs in the renderer with the browser DSP explicitly disabled:

```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: { exact: selectedDeviceId },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
})
```

This is chosen for cross-platform reasons. The same code runs on macOS and
Windows, with Chromium using CoreAudio and WASAPI respectively; device
enumeration is structured rather than scraped from a subprocess; ids are stable;
and `devicechange` is a real event. Because Electron ships a pinned Chromium the
constraints behave predictably, instead of depending on whichever engine a user
happens to have — the objection that would apply in an ordinary browser does not
apply here.

**Verify, do not assume.** After acquiring the stream the app asserts that
`track.getSettings()` really reports the processing off, and surfaces that in the
UI. A silently re-enabled AGC is otherwise invisible until it has already ruined
an event.

Capture chain:

```
getUserMedia (channelCount: device max)
  → MediaStreamAudioSourceNode
  → ChannelSplitterNode        ← operator picks the channel index here
  → AudioWorklet (mono)
  → Float32 to i16 → 640-byte frames
  → WebSocket to the server
```

`AudioContext({ sampleRate: 16000 })` does the resampling. The splitter runs
`channelInterpretation: "discrete"` so channels are never downmixed before
selection.

**Channel selection with the XR18.** The two platforms expose it differently and
the app adapts rather than pretending they are the same:

- macOS: one 18-channel device; the splitter selects any of the 18.
- Windows: the WDM driver presents USB 1-2, 3-4, 5-6, 7-8 and 1-8 as separate
  devices, so the device dropdown selects the pair and the splitter selects
  within it. Channels 9–18 are unreachable without ASIO.

**Report the achieved channel count, do not assume it.** Chromium may deliver
fewer channels than requested. The app reads
`track.getSettings().channelCount` and shows it beside the picker; if it is
lower than the device advertises, it warns in Korean that the channel should be
routed on the mixer instead. Silently capturing the wrong channel is the failure
this prevents.

**Required rig setup on Windows.** OBS and the operator app want *different*
audio, not a shared feed, so give each its own USB pair. The X-AIR WDM driver
exposes USB 1-2, 3-4, 5-6 and 7-8 as separate Windows devices:

| XR18 USB send | Fed by | Consumer |
|---|---|---|
| USB 1-2 | Aux 1 — instrumental / band | OBS source "Instrumental" |
| USB 3-4 | Aux 2 — vocals | OBS source "Vocals" |
| USB 5-6 | Aux 3 — **only the speech mics** | Operator app |

OBS adds one Audio Input Capture source per device, giving independent faders
and filters for instrumental and vocal in the stream. The operator app points at
USB 5-6 and takes the left channel.

This arrangement is required rather than preferred, for three reasons:

1. Channels 9–18 are unreachable over WDM, so software selection cannot reach
   them at all.
2. Separate devices mean **no contention** — OBS and the operator app never open
   the same endpoint, so WASAPI sharing behaviour and `obs-asio` exclusivity both
   stop mattering. `obs-asio` is also no longer needed, since OBS gets what it
   needs over WDM.
3. The translation bus can carry a speech-only mix — no music, no audience mics,
   no reverb return. The stream's vocal stem is mixed for human listening; this
   bus is mixed for a machine, and the difference shows up directly in
   translation quality.

**Set the translation aux pre-fader.** If it is post-fader, an engineer riding
the vocal fader down for the broadcast mix also drops the translation feed, and
listeners simply lose the speaker. Confirm during setup how the bus handles
**mute**: pre-fader sends often pass muted channels through, which is usually not
what you want for a mic muted deliberately.

Escape hatch if Chromium downmixes on macOS: spawn ffmpeg with `avfoundation`
to capture all 18 channels and `pan` to one. This does not help on Windows,
where ASIO is the blocker. Not built in v1.

Single window, all labels Korean:

| Panel | Contents |
|---|---|
| 입력 장치 | Device dropdown from `enumerateDevices()`, channel picker (splitter index), requested vs **achieved** channel count, detected sample rate, DSP-off confirmation |
| 레벨 미터 | RMS + peak from an `AnalyserNode`, clipping indicator |
| 접속 정보 | Large QR of `http://<lan-ip>:8080` + the URL in large type; auto-detected IP, dropdown if several interfaces |
| 레인 현황 | Per lane: 언어 · 청취자 수 · 상태 · 레인 드롭 · 청취자 드롭 · 세션 상태 |
| 제어 | 시작 / 중지, server connection status |

Settings persist with `electron-store`.

**Server hosting:** the server runs in an Electron **`utilityProcess.fork()`** —
crash-isolated from the UI, restartable, and shipped as ordinary `node_modules`
rather than a compiled sidecar binary. `@discordjs/opus` is rebuilt through
Forge's `rebuildConfig` and marked external in `vite.main.config.mts`. A
`--external-server` flag skips the fork during development.

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
every subscriber. VOIP mode, ~24 kbps mono, 20 ms frames. If rebuilding the native
`@discordjs/opus` addon ever proves painful on a target platform, a WASM
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
| Audio interface unplugged | `devicechange` fires and the track ends → stop capture, surface a Korean error, offer re-pick. `deviceId: { exact }` already fails rather than silently substituting the built-in mic |
| Attendee wifi drops | `<audio>` stalls; client detects and re-requests at live edge |
| Lane cap reached | "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now" |
| API key invalid or quota exhausted | Fail loudly on the operator dashboard, not silently per lane |

## Testing

- **`FakeTranslateSession`** echoes input as 24 kHz PCM with synthetic
  transcripts. Makes lanes, refcounting, rotation, history and backpressure
  deterministic. Zero API spend in CI.
- Fake clock for rotation and grace timers.
- Golden test: WAV in → WebM out, remux and compare RMS.
- Renderer: push a known sine sweep through the capture chain and assert the 16 kHz
  output is clean and every emitted frame is exactly 640 bytes.
- Manual rehearsal checklist, run on the actual venue laptop with OBS running:
  1. Each consumer is on its own USB pair: OBS on USB 1-2 and 3-4, the operator
     app on USB 5-6.
  2. OBS and the operator app run together with all meters moving, and riding the
     OBS vocal fader does not change the operator app's level meter.
  3. Windows Firewall allows inbound 8080, and the venue wifi is classified
     **Private** rather than Public.
  4. A phone on venue wifi actually loads the join URL.
  5. One full 60-minute run crossing at least five connection boundaries, with
     OBS encoding the whole time.

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

- **Alternative audio routings** — if the XR18's aux buses are all committed,
  OBS can own the interface and feed the operator app through VB-CABLE plus the
  Audio Monitor filter, or VoiceMeeter can act as a hub taking ASIO in and
  serving virtual outputs to both. Neither needs code changes; both are just a
  different entry in the device dropdown. The VB-CABLE route couples the two
  systems, so translation stops if OBS stops.
- **OBS output** — deferred, but the **route is reserved**. OBS runs on the same
  laptop, so a Browser Source can point at `ws://localhost:8080/listen?lang=xx`,
  which already carries `history` and `transcript` messages — everything an
  overlay needs. No server work is required to enable this; only the styled HTML
  page is unbuilt. Note the consequence: an OBS overlay counts as a subscriber,
  so it pins that language's lane open for the whole event and incurs its API
  cost even with no phones listening.
- **HTTPS / WebRTC** — would restore Wake Lock, WebCodecs and better jitter
  handling, and would make iOS ignore the silent switch. Requires a real domain
  whose A record points at the venue LAN IP, certified via DNS-01. Attaches at
  the FrameBus sink abstraction. Revisit if a rehearsal shows HTTP hurting.
- **Attendee mobile app** — would give native decode and a native audio session,
  the only thing that truly fixes the iOS silent switch. Electron has no mobile
  target, so this would be a separate React Native or Capacitor effort rather
  than shared code. Blocked by distribution regardless: walk-in attendees scan
  QR codes, they do not install apps. Viable only for a recurring audience.
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
- **Windows Firewall will silently block the attendee port.** The server listens
  on all interfaces, but Windows blocks inbound connections by default, and if
  the venue wifi is classified as a **Public** network it blocks them even when a
  Private-profile rule exists. Phones then fail to load the page with no error on
  the laptop. The operator app should surface reachability rather than assume it,
  and this belongs on the pre-event checklist.
- XR18 channels 9–18 are unreachable on Windows without ASIO. Route the feed to
  one of the USB 1-8 pairs instead, or run the operator app on macOS.
- If a rehearsal ever forces OBS and the operator app onto the *same* USB pair,
  OBS must use WASAPI rather than `obs-asio`, which takes the device exclusively.
  The separate-pair routing above avoids this entirely.

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
