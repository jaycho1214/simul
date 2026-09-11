import { test } from "node:test";
import assert from "node:assert/strict";
import { vintSize, uint, float64, id, elem, UNKNOWN_SIZE } from "./ebml.ts";

test("vintSize uses one byte for small values with the marker bit set", () => {
  assert.deepEqual([...vintSize(1)], [0x81]);
  assert.deepEqual([...vintSize(126)], [0xfe]);
});

test("vintSize rolls over to two bytes at 127", () => {
  // 127 is the one-byte reserved 'unknown' pattern, so it must widen.
  assert.equal(vintSize(127).length, 2);
  assert.deepEqual([...vintSize(127)], [0x40, 0x7f]);
});

test("uint is big-endian with no leading zeroes", () => {
  assert.deepEqual([...uint(0)], [0x00]);
  assert.deepEqual([...uint(255)], [0xff]);
  assert.deepEqual([...uint(256)], [0x01, 0x00]);
  assert.deepEqual([...uint(1_000_000)], [0x0f, 0x42, 0x40]);
});

test("float64 is an eight-byte big-endian double", () => {
  const b = float64(48000);
  assert.equal(b.length, 8);
  assert.equal(b.readDoubleBE(0), 48000);
});

test("id parses a multi-byte element id", () => {
  assert.deepEqual([...id(0x1a45dfa3)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.deepEqual([...id(0xa3)], [0xa3]);
});

test("elem frames id + size + payload", () => {
  const out = elem(id(0xa3), Buffer.from([0xde, 0xad]));
  assert.deepEqual([...out], [0xa3, 0x82, 0xde, 0xad]);
});

test("UNKNOWN_SIZE is the eight-byte all-ones pattern", () => {
  assert.deepEqual([...UNKNOWN_SIZE], [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
});

test("vintSize throws for a value too large for an 8-byte vint", () => {
  assert.throws(
    () => vintSize(2 ** 56),
    (err: unknown) => {
      assert(err instanceof Error);
      assert(err.message.includes("value too large for an EBML vint"));
      return true;
    },
  );
});

test("vintSize rolls over to three bytes at 16383", () => {
  // 16383 is the 2-byte reserved 'all-ones' pattern, so it must widen.
  assert.equal(vintSize(16383).length, 3);
  assert.deepEqual([...vintSize(16383)], [0x20, 0x3f, 0xff]);
});
