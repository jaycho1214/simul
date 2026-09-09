import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "./clock.ts";

test("FakeClock fires timers only when time advances", () => {
  const clock = new FakeClock();
  let fired = false;
  clock.setTimeout(() => { fired = true; }, 1000);

  clock.advance(999);
  assert.equal(fired, false);
  clock.advance(1);
  assert.equal(fired, true);
});

test("FakeClock does not fire a cancelled timer", () => {
  const clock = new FakeClock();
  let fired = false;
  const t = clock.setTimeout(() => { fired = true; }, 100);
  clock.clearTimeout(t);
  clock.advance(500);
  assert.equal(fired, false);
});

test("FakeClock advances now()", () => {
  const clock = new FakeClock(1000);
  clock.advance(250);
  assert.equal(clock.now(), 1250);
});
