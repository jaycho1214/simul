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
