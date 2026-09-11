import { test } from "node:test";
import assert from "node:assert/strict";
import type { LaneState } from "@tongyeok/protocol";
import { FakeClock } from "../clock.ts";
import { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { createFakeTranslateSessionFactory, FakeTranslateSession } from "../gemini/fake-translate-session.ts";
import { SourceLane } from "./source-lane.ts";
import { TranslatedLane } from "./translated-lane.ts";

const silence = () => Buffer.alloc(640);

// Lets a real (macro)task boundary pass, so the rotation a session's own
// event handler kicks off with a fire-and-forget `void rotate()` settles.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Buffer.alloc's all-zero silence takes a different code path in libopus than
// real signal does, so any test where a pushed buffer reaches the encoder
// directly (SourceLane relays exactly what it's given) uses a real waveform
// instead. TranslatedLane's pushPcm content never reaches its own encoder —
// only the fake session's internally generated audio does, and that is
// already non-silent by construction — so silence() is fine there.
function tone(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes);
  for (let s = 0; s < bytes / 2; s++) {
    buf.writeInt16LE(Math.round(8000 * Math.sin(s / 6)), s * 2);
  }
  return buf;
}

test("SourceLane encodes ingest PCM and emits clusters", () => {
  const lane = new SourceLane("ko", 24000, new FakeClock());
  const clusters: Buffer[] = [];
  lane.subscribeClusters((c) => clusters.push(c));

  // 40 ms clusters, 20 ms frames: five frames complete two clusters and
  // leave the fifth waiting for a partner.
  for (let i = 0; i < 5; i++) lane.pushPcm(tone(640));

  assert.equal(lane.state, "live");
  assert.equal(clusters.length, 2);
  assert.ok(lane.initSegment.includes(Buffer.from("OpusHead")));

  lane.close();
});

test("SourceLane never produces transcripts", () => {
  const lane = new SourceLane("ko", 24000, new FakeClock());
  assert.equal(lane.transcripts.history().length, 0);
  for (let i = 0; i < 50; i++) lane.pushPcm(tone(640));
  assert.equal(lane.transcripts.history().length, 0);

  lane.close();
});

test("SourceLane.close() disposes its Opus encoder", (t) => {
  const closeSpy = t.mock.method(LaneOpusEncoder.prototype, "close");
  const lane = new SourceLane("ko", 24000, new FakeClock());

  lane.close();

  assert.equal(closeSpy.mock.callCount(), 1);
});

test("TranslatedLane turns session audio into clusters", async () => {
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  const clusters: Buffer[] = [];
  lane.subscribeClusters((c) => clusters.push(c));

  // 25 frames drives one 500 ms fake utterance = 24000 bytes @ 24 kHz.
  for (let i = 0; i < 25; i++) lane.pushPcm(silence());

  assert.ok(clusters.length >= 4, `expected several clusters, got ${clusters.length}`);

  lane.close();
});

test("TranslatedLane records transcripts in its bus", async () => {
  const lane = await TranslatedLane.create({
    lang: "es",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  for (let i = 0; i < 50; i++) lane.pushPcm(silence());

  assert.deepEqual(
    lane.transcripts.history().map((l) => l.text),
    ["es utterance 1", "es utterance 2"],
  );

  lane.close();
});

test("TranslatedLane counts drops when the session cannot accept", async () => {
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  lane.close();
  for (let i = 0; i < 10; i++) lane.pushPcm(silence());

  assert.equal(lane.laneDrops, 10);
});

test("TranslatedLane.create wraps the factory in a SessionRotator so lanes survive reconnects", async () => {
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  // SessionRotator.activeIndex only exists on the rotator, not on a bare
  // TranslateSession — reading it here is only possible if TranslatedLane
  // is actually driven by a SessionRotator rather than a raw session.
  const session = (lane as unknown as { session: { activeIndex: number } }).session;
  assert.equal(session.activeIndex, 0);

  lane.close();
});

test("TranslatedLane.close() disposes its Opus encoder", async (t) => {
  const closeSpy = t.mock.method(LaneOpusEncoder.prototype, "close");
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  lane.close();

  assert.equal(closeSpy.mock.callCount(), 1);
});

test("TranslatedLane.close() is idempotent", async (t) => {
  // A doesNotThrow-only assertion would pass even without the lane's own
  // `if (this.closed) return;` guard, since both SessionRotator.close() and
  // LaneOpusEncoder.close() are independently idempotent. Spying on the
  // encoder's close() proves the *lane* short-circuits the second call
  // itself, rather than merely relying on its collaborators never breaking.
  const closeSpy = t.mock.method(LaneOpusEncoder.prototype, "close");
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  lane.close();
  assert.doesNotThrow(() => lane.close());

  assert.equal(closeSpy.mock.callCount(), 1);
});

test("TranslatedLane.create closes the session it opened when constructing the lane throws", async () => {
  const created: FakeTranslateSession[] = [];

  // A bitrate of 0 is what `OPUS_BITRATE=` (set but empty) used to produce,
  // and libopus rejects it outright: `new LaneOpusEncoder(24000, 0)` throws
  // "Encoder CTL error: Bad argument". By then `rotator.start()` has already
  // awaited a real, billing Gemini connection into existence. If the throw
  // escapes untouched that rotator is in neither LaneManager's `entries` nor
  // its `opening` — unreachable, so nothing can ever close it — and a fresh
  // one is opened for every subsequent attendee tap, scaling with taps
  // rather than with language count.
  await assert.rejects(
    () => TranslatedLane.create({
      lang: "en",
      clock: new FakeClock(),
      opusBitrate: 0,
      historyLines: 200,
      sessionFactory: createFakeTranslateSessionFactory((s) => created.push(s)),
    }),
    /Bad argument/,
  );

  assert.equal(created.length, 1, "a live session was opened before the constructor ran");
  assert.equal(
    created[0]!.canAccept(),
    false,
    "the orphaned session must be closed on the way out, not leaked with no handle left to close it",
  );
});

test("SourceLane publishes its state change to subscribers", () => {
  const lane = new SourceLane("ko", 24000, new FakeClock());
  const states: LaneState[] = [];
  lane.onStateChange((s) => states.push(s));

  assert.equal(lane.state, "live");
  assert.deepEqual(states, [], "subscribing is not itself an event");

  lane.close();
  assert.deepEqual(states, ["error"]);

  lane.close();
  assert.deepEqual(states, ["error"], "a second close() is not a second change");
});

test("TranslatedLane publishes every lane-state change, and only changes", async () => {
  const created: FakeTranslateSession[] = [];
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory((s) => created.push(s)),
  });

  const states: LaneState[] = [];
  const off = lane.onStateChange((s) => states.push(s));

  // `Lane.state` is a plain getter, so every consumer of it — the admin
  // dashboard's once-a-second poll included — can only ever learn about a
  // change by asking again. A listen socket, which sends `{type:"lane"}`
  // exactly once at connect, never asks again: without an event here its
  // attendee's status indicator is frozen at whatever it read on connect,
  // for the whole event.
  assert.equal(lane.state, "starting");
  lane.pushPcm(silence());
  assert.deepEqual(states, ["live"]);
  assert.equal(lane.state, "live");

  for (let i = 0; i < 30; i++) lane.pushPcm(silence());
  assert.deepEqual(states, ["live"], "a state that has not changed is not republished");

  created[0]!.simulateGoAway();
  await flush();
  assert.deepEqual(states, ["live", "reconnecting"]);

  off();
  lane.close();
  assert.deepEqual(states, ["live", "reconnecting"], "unsubscribing really unsubscribes");
  assert.equal(lane.state, "error");
});

test("TranslatedLane publishes the error state when the lane is closed", async () => {
  const lane = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const states: LaneState[] = [];
  lane.onStateChange((s) => states.push(s));

  lane.close();
  assert.deepEqual(states, ["error"]);
});

test("a lane-state subscriber that throws cannot break close()", async (t) => {
  const errorMock = t.mock.method(console, "error", () => {});

  // close() is called in a loop by LaneManager.closeAll(). A subscriber that
  // threw out of it would abandon that loop partway, leaving the remaining
  // lanes — and their live, billing Gemini sessions — open through a
  // shutdown.
  const source = new SourceLane("ko", 24000, new FakeClock());
  const reached: LaneState[] = [];
  source.onStateChange(() => { throw new Error("subscriber blew up"); });
  source.onStateChange((s) => reached.push(s));
  source.close();
  assert.deepEqual(reached, ["error"], "the surviving subscriber was still notified");

  const translated = await TranslatedLane.create({
    lang: "en",
    clock: new FakeClock(),
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  translated.onStateChange(() => { throw new Error("subscriber blew up"); });
  translated.close();

  assert.equal(errorMock.mock.callCount(), 2, "both throws were logged, not swallowed");
});

// The model sends nothing until it first speaks, then a continuous real-time
// stream, silence included. The attendee's player holds 0.6 s of runway and
// reads any gap as a network stall, so the lane keeps its own stream
// continuous from the moment it exists. See TranslatedLane.scheduleFill.
test("TranslatedLane keeps its media clock on the wall clock until the session first speaks", async () => {
  const clock = new FakeClock(5_000);
  const lane = await TranslatedLane.create({
    lang: "en",
    clock,
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
    streamPrimeMs: 400,
  });
  const clusters: Buffer[] = [];
  lane.subscribeClusters((c) => clusters.push(c));
  assert.equal(lane.mediaMs, 400, "the prime is written at once, as before");

  clock.advance(1_000);
  assert.equal(lane.mediaMs, 1_400, "one second of wall clock is one second of silence");
  assert.ok(clusters.length > 0, "and it reaches listeners as clusters, not just the backlog");

  lane.close();
});

test("TranslatedLane follows the session's own pacing once it has spoken, filling only a real gap", async () => {
  const clock = new FakeClock();
  const lane = await TranslatedLane.create({
    lang: "en",
    clock,
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  clock.advance(1_000);
  assert.equal(lane.mediaMs, 1_000);

  // 25 frames make the fake session emit 500 ms of audio: the lane is now
  // ahead of the wall clock, as the real model runs a chunk or so ahead.
  for (let i = 0; i < 25; i++) lane.pushPcm(silence());
  assert.equal(lane.mediaMs, 1_500);

  // A deficit under FILL_AFTER_MS is the model's ordinary jitter: not filled,
  // or the filler would paste silence into speech.
  clock.advance(1_300);
  assert.equal(lane.mediaMs, 1_500, `deficit of ${2_300 - 1_500} ms is left alone`);

  // At FILL_AFTER_MS the gap is judged real and the timeline is brought up to
  // the wall clock — and then kept there every tick, not in one-second steps
  // that would have every phone run dry between them.
  clock.advance(200);
  assert.equal(lane.mediaMs, 2_500);
  clock.advance(200);
  assert.equal(lane.mediaMs, 2_700);

  // The session speaking again ends the fill: its audio lands where the
  // timeline stands, and a small deficit is once more left alone.
  for (let i = 0; i < 25; i++) lane.pushPcm(silence());
  assert.equal(lane.mediaMs, 3_200);
  clock.advance(1_000);
  assert.equal(lane.mediaMs, 3_200, `deficit of ${3_700 - 3_200} ms is left alone`);

  lane.close();
});

test("TranslatedLane.close() stops the filler before disposing the encoder", async () => {
  const clock = new FakeClock();
  const lane = await TranslatedLane.create({
    lang: "en",
    clock,
    opusBitrate: 24000,
    historyLines: 200,
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  clock.advance(500);
  const before = lane.mediaMs;

  lane.close();
  // A tick that survived close() would encode on a disposed encoder and throw.
  assert.doesNotThrow(() => clock.advance(5_000));
  assert.equal(lane.mediaMs, before);
});
