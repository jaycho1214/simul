import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { createFakeTranslateSessionFactory } from "../gemini/fake-translate-session.ts";
import { SourceLane } from "./source-lane.ts";
import { TranslatedLane } from "./translated-lane.ts";

const silence = () => Buffer.alloc(640);

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
