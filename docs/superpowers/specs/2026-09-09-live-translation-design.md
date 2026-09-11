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
│  IngestGateway ──► AudioHub ──┬─► Lane "ko" ─────────┼─► Gemini session
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

**AudioHub** — pure fan-out to open lanes. A lane that throws is isolated: the
exception is caught and logged, and every sibling still receives the frame.

**Stream priming and bitrate.** This reverses an earlier line in this spec,
which said there was no replay buffer and a cold lane started from now. That
turned out to cause a ~15 s delay before an attendee heard anything, so it is
now wrong on purpose.

Chrome's `<audio>` (`MultiBufferDataSource`) hands the demuxer network data
only in whole **32 KiB blocks**. Nothing plays — not even `loadedmetadata` —
until the first block is full, so the **wire byte rate sets the latency
floor**, and the low bitrate this spec chose for bandwidth was the direct cause
of the delay. Measured at 24 kbps: `loadedmetadata` at 9485 ms, matching
32768 B ÷ 3475 B/s = 9.43 s, and the stream then stalled every ~9.5 s — one
block period — for as long as it ran.

Two consequences drive the design:

1. **`OPUS_BITRATE` is now 128 kbps CBR, chosen for timing rather than
   quality.** A block fills in ~2.0 s instead of 9.4 s, and staying under
   Chrome's 3 s `stalled` timer also stops the attendee app tearing the stream
   down between blocks. CBR matters independently: under VBR a 20 ms frame of
   silence encodes to *three bytes*, so a quiet room slows the byte rate to a
   crawl and startup would depend on whether anyone happened to be talking.
   The cost is ~16 KB/s per phone — 60 phones is ~8 Mbps of venue wifi against
   1.5 Mbps before. Lower it if the AP cannot take that and expect the delay to
   rise in proportion.
2. **`STREAM_PRIME_MS` (default 4 s)** pre-fills that first block from a
   rolling backlog of recent clusters, so a joining listener does not wait for
   it in real time. A cold lane primes the same backlog with encoded silence at
   construction. Every new `/stream/<lang>.webm` gets the init segment, then
   the backlog, then live clusters.

**The prime is not free, and its duration is latency.** A plain `<audio src>`
starts at the *oldest* cluster it receives and never skips forward, and plays
at exactly 1.0×, so whatever backlog is sent up front is a permanent offset
behind the room. Keep `STREAM_PRIME_MS` just above one block's worth. An
earlier 12 s default made this worse, not better — startup was fast but every
listener sat 12 s behind. The attendee app's plain path also rejoins if it
ever finds itself further behind the lane clock than the prime explains
(`maxDriftSecFor` in `audio-stream-controller.ts`; the server publishes the
prime on `/config` as `streamPrimeMs`), which catches drift after a stall
rather than being the primary mechanism.

**Playback path (measured 2026-09-11).** Two things were found on the
passthrough lane, both on the phone side of the wire:

1. The operator app still shipped `opusBitrate: 24000` as its default and had
   written it into its settings file, while the server had moved to 128 kbps.
   At 24 kbps the derived prime is 16.4 s, so every listener sat 16.4 s
   behind — the "17–20 s" an attendee reported. The operator default is now
   128 kbps, and a stored 24000 is read as the old default rather than a
   choice (nothing in the panels sets it).
2. The plain path's drift check compared the lane clock against the playhead
   with a fixed 8 s threshold. With a 16 s prime that is true from the first
   second, so the stream was restarted every 5 s, forever. The threshold is
   now the prime plus 5 s, floor 8 s.

Fixing both leaves the plain path 3.1 s behind the room at 128 kbps — the
1.5-block prime plus startup — and that is the floor of that design, because
Chrome hands the demuxer bytes only in whole 32 KiB blocks and the wire rate
sets it. So the attendee app now has a second, preferred path: where
`MediaSource.isTypeSupported('audio/webm; codecs="opus"')` is true, the page
downloads the same `/stream/<lang>.webm` with `fetch()` and appends it to a
SourceBuffer (`mse-stream-controller.ts`). The demuxer then sees every 40 ms
cluster as it lands (`WebMSink` flushed every 100 ms until 2026-09-11; the
smaller cluster costs 9 bytes of header and saves ~60 ms), the buffered range
carries the lane's own timestamps, and the playhead is held a fixed target
behind the newest audio: 0.6 s, widened by 0.5 s per underrun up to 3 s. Small
drift past the target — the ~250 ms between placing the playhead and `play()`
actually starting, or a stall Chrome recovered from on its own — is played
out at 1.05× with the pitch preserved until the target is back; only a drift
past 1.5 s is skipped over with a seek. Measured on the passthrough lane in
Chromium: 0.6 s behind the lane clock, at 24 kbps and at 128 kbps alike, no
restarts (1.1–1.5 s with the earlier 1 s target and 100 ms clusters). Decode and output
still belong to the media element, so background playback is unchanged. A
browser without that support (iPhone Safari has no `MediaSource` before 17.1,
and its Opus-in-WebM support through it is unverified) gets the plain path and
its ~3 s. The bitrate therefore buys latency only for the plain path now; it
stays at 128 kbps for those phones.

**Where the latency actually is (measured 2026-09-11).** Speech-in to
speech-out on a translated lane, synthesized Korean into the real API,
default config, two runs:

| Stage | Measured |
|---|---|
| Speech starts → first audio message from the model | 1.0–1.3 s, and it is silence |
| Speech starts → first translated word heard | 3.2–3.7 s |
| Source sentence ends → translated sentence ends | ~4.0 s |
| Speech starts → first transcript text | ~2.8 s (text leads its audio by ~0.5 s) |
| Model output cadence | 250 ms chunks; gaps 250 ms median, 327 ms p99, 331 ms max over 68 s |
| Server (encode, 40 ms cluster, write) | tens of ms |
| MediaSource player runway | 0.6 s target |

VAD tuning (`realtimeInputConfig.automaticActivityDetection` at high
sensitivity, 200 ms silence) and 100 ms input chunks instead of 20 ms changed
nothing outside run-to-run noise. So of roughly four seconds from mouth to
ear, the model owns well over three, and the part this system controls is the
player's runway. That runway cannot go much below 0.6 s: playback sits on a
250 ms sawtooth as the model's chunks land, and its bottom must clear the
worst chunk gap plus wifi jitter, or the phone stalls and widens the target
by 0.5 s anyway. What has changed is the ratchet: the target used to widen on
every underrun and never narrow, so one hiccup at the door cost half a second
for the rest of the event and five put a phone three seconds behind. It now
narrows by 0.25 s for every 90 s without an underrun, back to the initial
target and no further; each underrun restarts that clock, so a phone in a
bad spot settles at the runway that actually holds there.

Two levers remain, both trade-offs rather than fixes: the plain-path prime
halves if `OPUS_BITRATE` doubles to 256 kbps (32 KB/s per such phone), and a
different model or API mode might translate sooner than this one, at a
quality cost nobody has measured.

**Lane** — one per active language:
- `TranslatedLane`, for every offered language: `SessionRotator` → 24 kHz PCM
  → Opus → FrameBus, and `outputTranscription` → TranscriptBus.
- `SourceLane`, the `original` lane: ingest PCM 16k → Opus → FrameBus. No API
  call, no cost, no transcript. Exists only while `PASSTHROUGH_LANE` is on.

**No source language (2026-09-11).** The Live Translate API takes only a
target language per session and detects what is spoken; with
`echoTargetLanguage: true` it parrots speech that is already in the target
language rather than going silent. So the earlier "source language =
passthrough lane" model is gone: a speaker who switches from Korean to
English mid-talk is still translated into Korean for the 한국어 lane, and an
English listener hears English either way. The untranslated room audio is
now the `original` lane, a debugging aid the operator switches on from the
language panel; it is listed last in the picker, tagged as debug, and costs
nothing. The cost of the change is that a Korean listener on the 한국어 lane
hears the model's re-voicing of a Korean speaker, a few seconds late, rather
than the room — the price of not knowing in advance what language the next
sentence will be in.

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
한국어
English
Español
日本語
원음  (Original · debug)      ← only while PASSTHROUGH_LANE is on
```

The tap that picks a language also satisfies iOS's user-gesture requirement for
audio. There is no auto-start path.

**One mode only:** audio and transcript together.

- Audio is one `<audio>` element fed one of two ways, chosen per tap in
  `createAudioController`: through MediaSource Extensions where the browser
  can demux Opus/WebM that way (about a second behind the room), otherwise as
  a plain `<audio src="/stream/es.webm">` (behind by the server's prime, ~3 s).
  Decode, jitter buffering and loss concealment all live in the OS media stack
  either way — no WASM, no scheduler, no jitter buffer in our code, and it
  works on old hardware. See "Playback path" under Stream priming for the
  measurements.
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

**What the translate model actually sends (measured 2026-09-11).** Against
the real API, fed a synthesized Korean sentence, 45 s of mic-level noise,
and a second sentence:

- **Audio is a continuous real-time stream once it starts, silence
  included.** Nothing arrives until the model first speaks (~1 s after the
  first utterance begins); from then on exactly 1000 ms of 24 kHz PCM per
  wall second, at -90 dBFS through the whole pause. The attendee's player
  holds only 0.6 s of runway and reads any gap as a network stall, so a
  cold lane's silence prime drained and every first listener saw
  "오디오 재연결 중 / Reconnecting audio" until the first sentence had been
  translated. `TranslatedLane` therefore writes silence at wall-clock rate
  until the session first speaks, and again if its audio ever falls more
  than a second behind (a dead connection while `SessionRotator` replaces
  it), so the stream is continuous from the moment the lane exists.
- **`outputTranscription` never carries `finished`, and `turnComplete`
  never arrives.** The model "translates as the speaker talks without
  waiting for turns" (its docs), so there is no turn to close: the
  transcription is text fragments about a second apart, and during silence
  an empty `outputTranscription` every ~2 s. Waiting for those flags made
  the transcript one line that grew for the whole event. Lines are now cut
  by `GeminiTranslateSession` itself: at a sentence terminator followed by
  whitespace (or a full-width one), and otherwise once no fragment has
  arrived for `TRANSCRIPT_IDLE_MS` (2 s). See `segment-lines.ts`.
- **A speaker heard through a phone loops forever.** With
  `echoTargetLanguage: true`, speech already in the target language is
  parroted. Feed the model's own output back in — a laptop mic that can hear
  the phone, or the operator listening on speakers — and it parrots the last
  sentence verbatim every two seconds for as long as the path exists (a
  digital loopback of one sentence ran 32 s without decaying). This is not
  a pipeline bug and no server-side change fixes it: the same path also
  loops across two lanes without echo, each translating the other. Test on
  earphones, or with the attendee page muted while speaking; the operator's
  device panel says so beside the DSP-off line.

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

   Partly answered without a stopwatch, on 2026-09-11, by measuring the
   Korean passthrough lane — which has no Gemini in its path, so whatever it
   shows is pure transport cost. The server was blameless: init segment at
   +6 ms, then one cluster every ~96 ms, 3475 B/s, dead on real time. The
   ~15 s an attendee actually experienced was the media element's duration
   gate; see "Stream priming" above. What remains unmeasured is the part
   this spike was really for: Gemini's own speech-in-to-speech-out latency
   on a translated lane, which still needs a real stopwatch and a human
   voice.

   Answered for the transport later the same day with the MediaSource path
   (see "Playback path" under Stream priming): 0.6 s behind the lane
   clock in Chromium, against 3.1 s for the plain element at 128 kbps and
   16.4 s at the operator app's old 24 kbps default. The deferred WS audio
   path is not needed for latency. Gemini's own speech-to-speech latency on
   a translated lane is still unmeasured.
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
- Low-latency WS audio path — no longer needed: the MediaSource path in
  `apps/web` (2026-09-11) sits ~1–1.5 s behind the room over plain HTTP.
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
- **There is no real backpressure toward Gemini.** An earlier draft of this spec
  claimed each lane holds a bounded queue that drops oldest under stall. That is
  not implementable as described: `ws.send()` never blocks, so a stalled Gemini
  connection grows an invisible buffer inside the SDK rather than stalling our
  fan-out loop, and `@google/genai` does not expose the underlying socket's
  buffered byte count. A queue drained synchronously in the same call can never
  fill, so it would isolate nothing. What the server actually guarantees is
  **throw isolation** — one lane's exception cannot stop the others — plus real
  backpressure on the *listener* side, where the HTTP response stream's
  `writableLength` is visible and enforced. If a stalled session ever proves to
  cause unbounded memory growth in practice, this needs revisiting with an
  explicit send queue and an async drain.
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
| `PASSTHROUGH_LANE` | `false` | Offer the untranslated `original` lane (debug, no API cost) |
| `OFFERED_LANGUAGES` | `["ko","en","es","ja"]` | Shown on the picker |
| `MAX_CONCURRENT_LANES` | 6 | Bounds worst-case spend |
| `LANE_GRACE_MS` | 60000 | Delay before teardown at refcount 0 |
| `TRANSCRIPT_HISTORY_LINES` | 200 | Per lane |
| `TRANSCRIPT_DELAY_MS` | 0 | Tune after spike 2 |
| `OPUS_BITRATE` | 128000 | Per lane, CBR. Sets the latency floor, not just quality |
| `STREAM_PRIME_MS` | 4000 | Recent audio handed to a joining listener; also added to their latency; 0 disables |
| `BRAND_NAME` | *unset* | Event name in the attendee app's bar |
| `BRAND_ACCENT` | `#3e8fd0` | Hex; rejected at startup if unparseable |
| `BRAND_LOGO` | *unset* | Path to an image, served at `/brand/logo` |
| `BRAND_THEME` | `dark` | `dark` \| `light` \| `auto` |
