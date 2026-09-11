import { test } from "node:test";
import assert from "node:assert/strict";
import { LaneOpusEncoder, frameBytesFor } from "./opus-encoder.ts";

test("frameBytesFor matches 20 ms of mono s16le", () => {
  assert.equal(frameBytesFor(16000), 640);
  assert.equal(frameBytesFor(24000), 960);
});

test("emits one packet per complete frame", () => {
  const enc = new LaneOpusEncoder(24000, 24000);
  const packets = enc.encode(Buffer.alloc(960 * 3));
  assert.equal(packets.length, 3);
  assert.ok(packets.every((p) => p.length > 0));
});

test("holds a partial frame until the rest arrives", () => {
  const enc = new LaneOpusEncoder(24000, 24000);
  assert.equal(enc.encode(Buffer.alloc(500)).length, 0);
  assert.equal(enc.pendingBytes, 500);
  assert.equal(enc.encode(Buffer.alloc(460)).length, 1);
  assert.equal(enc.pendingBytes, 0);
});

test("handles input spanning many frames plus a remainder", () => {
  const enc = new LaneOpusEncoder(16000, 24000);
  const packets = enc.encode(Buffer.alloc(640 * 4 + 100));
  assert.equal(packets.length, 4);
  assert.equal(enc.pendingBytes, 100);
});

test("encodes non-silent audio to a non-empty packet", () => {
  // Buffer.alloc's all-zero silence takes a different code path in libopus
  // than real signal does — silence alone cannot prove the encoder works.
  const enc = new LaneOpusEncoder(24000, 24000);
  const pcm = Buffer.alloc(960);
  for (let s = 0; s < 480; s++) {
    pcm.writeInt16LE(Math.round(8000 * Math.sin(s / 6)), s * 2);
  }
  const packets = enc.encode(pcm);
  assert.equal(packets.length, 1);
  assert.ok(packets[0]!.length > 0);
});

test("close() is idempotent", () => {
  const enc = new LaneOpusEncoder(24000, 24000);
  enc.close();
  assert.doesNotThrow(() => enc.close());
});

test("encode() after close() throws instead of touching freed WASM memory", () => {
  const enc = new LaneOpusEncoder(24000, 24000);
  enc.close();
  assert.throws(() => enc.encode(Buffer.alloc(960)), /close/);
});

// Chrome's <audio> MultiBufferDataSource exposes network data to the demuxer
// only in whole 32 KiB blocks, so the WIRE BYTE RATE — not the audio content —
// decides how long a listener waits before hearing anything. Under VBR a
// silent room emits tiny packets, the byte rate collapses, and the block takes
// even longer to fill. CBR makes that timing deterministic.
test("encodes at a constant bitrate, so silence costs the same bytes as speech", () => {
  const enc = new LaneOpusEncoder(16000, 128000);

  const silence = enc.encode(Buffer.alloc(640))[0]!;

  const tone = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) {
    tone.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / 16000)), i * 2);
  }
  const speech = enc.encode(tone)[0]!;

  assert.equal(
    silence.length,
    speech.length,
    `silence ${silence.length}B vs speech ${speech.length}B — VBR would make block timing depend on whether anyone is talking`,
  );
  enc.close();
});
