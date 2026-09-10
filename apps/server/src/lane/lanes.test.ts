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

  // 100 ms cluster size, 20 ms frames: five frames complete one cluster.
  for (let i = 0; i < 5; i++) lane.pushPcm(tone(640));

  assert.equal(lane.state, "live");
  assert.equal(clusters.length, 1);
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
