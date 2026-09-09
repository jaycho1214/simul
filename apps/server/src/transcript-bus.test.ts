import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "./clock.ts";
import { TranscriptBus } from "./transcript-bus.ts";

test("assigns increasing sequence numbers and clock timestamps", () => {
  const clock = new FakeClock(5000);
  const bus = new TranscriptBus(clock, 200);

  const a = bus.publish("안녕하세요", true);
  clock.advance(250);
  const b = bus.publish("hello", true);

  assert.equal(a.seq, 1);
  assert.equal(a.ts, 5000);
  assert.equal(b.seq, 2);
  assert.equal(b.ts, 5250);
});

test("history keeps only the most recent N lines", () => {
  const bus = new TranscriptBus(new FakeClock(), 3);
  for (let i = 1; i <= 5; i++) bus.publish(`line ${i}`, true);

  const history = bus.history();
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((l) => l.text), ["line 3", "line 4", "line 5"]);
});

test("interim lines are delivered but never stored in history", () => {
  const bus = new TranscriptBus(new FakeClock(), 10);
  const seen: string[] = [];
  bus.subscribe((l) => seen.push(l.text));

  bus.publish("partial", false);
  bus.publish("complete", true);

  assert.deepEqual(seen, ["partial", "complete"]);
  assert.deepEqual(bus.history().map((l) => l.text), ["complete"]);
});

test("unsubscribe stops delivery", () => {
  const bus = new TranscriptBus(new FakeClock(), 10);
  let count = 0;
  const off = bus.subscribe(() => { count++; });
  bus.publish("one", true);
  off();
  bus.publish("two", true);
  assert.equal(count, 1);
});
