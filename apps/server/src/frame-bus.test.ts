import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBus } from "./frame-bus.ts";

test("delivers frames to every subscriber", () => {
  const bus = new FrameBus();
  const a: Buffer[] = [];
  const b: Buffer[] = [];
  bus.subscribe((f) => a.push(f));
  bus.subscribe((f) => b.push(f));

  bus.publish(Buffer.from([1, 2]), 0);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0], b[0], "the same buffer object is shared, not copied");
});

test("unsubscribe stops delivery", () => {
  const bus = new FrameBus();
  const got: Buffer[] = [];
  const off = bus.subscribe((f) => got.push(f));
  bus.publish(Buffer.from([1]), 0);
  off();
  bus.publish(Buffer.from([2]), 20);
  assert.equal(got.length, 1);
  assert.equal(bus.subscriberCount, 0);
});

test("one throwing subscriber does not block the others", () => {
  const bus = new FrameBus();
  const got: Buffer[] = [];
  bus.subscribe(() => { throw new Error("boom"); });
  bus.subscribe((f) => got.push(f));
  bus.publish(Buffer.from([1]), 0);
  assert.equal(got.length, 1);
});
