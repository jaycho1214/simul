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

test("published lines are frozen and cannot be mutated", () => {
  const bus = new TranscriptBus(new FakeClock(), 10);
  const line = bus.publish("test", true);

  assert.throws(
    () => {
      // @ts-expect-error - testing runtime mutation
      line.text = "mutated";
    },
    TypeError,
  );

  // Verify history is unaffected
  const history = bus.history();
  assert(history[0] !== undefined);
  assert.equal(history[0].text, "test");
});

test("interim lines consume sequence numbers", () => {
  const bus = new TranscriptBus(new FakeClock(), 10);
  const interim = bus.publish("partial", false);
  const final = bus.publish("complete", true);

  assert.equal(interim.seq, 1);
  assert.equal(final.seq, 2);
});

test("subscriber throws are caught and logged", (t) => {
  const bus = new TranscriptBus(new FakeClock(), 10);
  const errorMock = t.mock.method(console, "error", () => {});

  let count = 0;
  bus.subscribe(() => { count++; });
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe(() => { count++; });

  bus.publish("test", true);

  assert.equal(count, 2);
  assert.equal(errorMock.mock.callCount(), 1);
  const call = errorMock.mock.calls[0];
  assert(call !== undefined);
  const [msg, err] = call.arguments;
  assert.equal(msg, "transcript subscriber threw");
  assert(err instanceof Error);
  assert.equal(err.message, "boom");
});
