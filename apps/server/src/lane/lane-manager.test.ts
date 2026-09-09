import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import { createFakeTranslateSessionFactory, FakeTranslateSession } from "../gemini/fake-translate-session.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { LaneManager, LaneCapError, UnknownLanguageError } from "./lane-manager.ts";

/**
 * A session factory the test controls by hand: the returned promise only
 * resolves when `resolve` is called. This is how the "closeAll / release
 * arrives while a Gemini session is still opening" tests hold the manager
 * open mid-acquire — real session setup is network I/O with exactly this
 * shape, just on a real clock instead of a manually-pulled lever.
 */
function deferredSessionFactory(): {
  factory: TranslateSessionFactory;
  resolve: (session: TranslateSession) => void;
} {
  let resolve!: (session: TranslateSession) => void;
  const factory: TranslateSessionFactory = () => new Promise((res) => { resolve = res; });
  return { factory, resolve: (session) => resolve(session) };
}

function makeManager(overrides: Partial<{ maxConcurrentLanes: number; laneGraceMs: number }> = {}) {
  const clock = new FakeClock();
  const hub = new AudioHub();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory: createFakeTranslateSessionFactory(),
    sourceLanguage: "ko",
    offeredLanguages: ["ko", "en", "es", "ja", "fr", "de", "zh"],
    maxConcurrentLanes: overrides.maxConcurrentLanes ?? 6,
    laneGraceMs: overrides.laneGraceMs ?? 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
  });
  return { clock, hub, manager };
}

test("opens a lane on the first subscriber and registers it with the hub", async () => {
  const { hub, manager } = makeManager();
  await manager.acquire("en", {});
  assert.equal(hub.laneCount, 1);
});

test("a second subscriber reuses the same lane", async () => {
  const { hub, manager } = makeManager();
  const a = await manager.acquire("en", {});
  const b = await manager.acquire("en", {});
  assert.equal(a, b);
  assert.equal(hub.laneCount, 1);
});

test("concurrent acquires of the same language open only one lane", async () => {
  const { hub, manager } = makeManager();
  const [a, b] = await Promise.all([manager.acquire("en", {}), manager.acquire("en", {})]);
  assert.equal(a, b);
  assert.equal(hub.laneCount, 1);
});

test("the lane survives until the grace period expires", async () => {
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const sub = {};
  await manager.acquire("en", sub);
  manager.release("en", sub);

  clock.advance(59999);
  assert.equal(hub.laneCount, 1, "still alive inside the grace window");

  clock.advance(1);
  assert.equal(hub.laneCount, 0, "torn down once grace expires");
});

test("re-acquiring within the grace period cancels teardown", async () => {
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const sub = {};
  await manager.acquire("en", sub);
  manager.release("en", sub);
  clock.advance(30000);
  await manager.acquire("en", {});
  clock.advance(60000);

  assert.equal(hub.laneCount, 1);
});

test("the source language lane costs no session", async () => {
  const { manager } = makeManager();
  const lane = await manager.acquire("ko", {});
  assert.equal(lane.constructor.name, "SourceLane");
});

test("rejects a language beyond the cap", async () => {
  const { manager } = makeManager({ maxConcurrentLanes: 2 });
  await manager.acquire("en", {});
  await manager.acquire("es", {});
  await assert.rejects(() => manager.acquire("ja", {}), LaneCapError);
});

test("rejects a language that is not offered", async () => {
  const { manager } = makeManager();
  await assert.rejects(() => manager.acquire("xx", {}), UnknownLanguageError);
});

test("statuses report listener counts and drops", async () => {
  const { manager } = makeManager();
  await manager.acquire("en", {});
  await manager.acquire("en", {});

  const [status] = manager.statuses();
  assert.equal(status!.lang, "en");
  assert.equal(status!.listeners, 2);
  assert.equal(status!.laneDrops, 0);
});

// The following three tests are not from the brief. They cover cases the
// brief's own list does not exercise but that would cost real money (or
// wrongly cut off a listener) if the implementation got them wrong.

test("a concurrent burst across different languages cannot exceed the cap", async () => {
  // The brief's cap test is sequential (each acquire is awaited before the
  // next starts), so it can't catch a cap check that only looks at settled
  // lanes and ignores in-flight opens. Firing three opens for three
  // different languages in the same tick is the actual failure mode: a
  // burst of concurrent requests each seeing "0 lanes open yet" and all
  // passing the cap check before any of them finishes opening.
  const { hub, manager } = makeManager({ maxConcurrentLanes: 2 });
  const results = await Promise.allSettled([
    manager.acquire("en", {}),
    manager.acquire("es", {}),
    manager.acquire("ja", {}),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 2);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]!.status === "rejected" && rejected[0]!.reason instanceof LaneCapError);
  assert.equal(hub.laneCount, 2, "the cap must hold even when opens race, not just when sequential");
});

test("closeAll closes every open lane and clears the hub", async () => {
  const { hub, manager } = makeManager();
  await manager.acquire("en", {});
  await manager.acquire("es", {});
  assert.equal(hub.laneCount, 2);

  manager.closeAll();

  assert.equal(hub.laneCount, 0);
  assert.equal(manager.get("en"), undefined);
  assert.equal(manager.get("es"), undefined);
});

test("closeAll cancels pending grace timers, not just closes lanes", async (t) => {
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const sub = {};
  await manager.acquire("en", sub);
  manager.release("en", sub); // schedules a grace timer due at t=60000

  const clearTimeoutSpy = t.mock.method(clock, "clearTimeout");
  manager.closeAll();

  assert.equal(
    clearTimeoutSpy.mock.callCount(),
    1,
    "the pending grace timer must be cancelled, not left dangling once its lane is gone",
  );
  assert.equal(hub.laneCount, 0);

  // Advancing time afterward must be a pure no-op: the timer is gone, not
  // merely harmless because its target was already torn down.
  assert.doesNotThrow(() => clock.advance(60000));
});

// The following two tests came out of code review, not the brief. Both are
// the same shape: `acquire()`'s in-flight open is invisible to the rest of
// the class — `entries` doesn't know about a language until the Gemini
// session finishes opening — so anything that happens during that window
// (a shutdown, a subscriber backing out) was being silently lost and
// re-applied incorrectly once the open resolved.

test("closeAll while an open is in flight closes the lane and never registers it", async () => {
  const clock = new FakeClock();
  const hub = new AudioHub();
  const { factory, resolve } = deferredSessionFactory();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory: factory,
    sourceLanguage: "ko",
    offeredLanguages: ["ko", "en"],
    maxConcurrentLanes: 6,
    laneGraceMs: 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
  });

  const acquiring = manager.acquire("en", {});
  // The Gemini session is still opening — "en" is in `opening`, not yet in
  // `entries` — when the server starts shutting down.
  manager.closeAll();

  resolve(new FakeTranslateSession("en"));
  const lane = await acquiring;

  assert.equal(
    hub.laneCount,
    0,
    "a lane whose open outlived closeAll() must never be registered with the hub",
  );
  assert.equal(lane.state, "error", "the session created after closeAll() must be closed, not left live");
});

test("release() before the open resolves does not create a phantom subscriber", async () => {
  const clock = new FakeClock();
  const hub = new AudioHub();
  const { factory, resolve } = deferredSessionFactory();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory: factory,
    sourceLanguage: "ko",
    offeredLanguages: ["ko", "en"],
    maxConcurrentLanes: 6,
    laneGraceMs: 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
  });

  const sub = {};
  const acquiring = manager.acquire("en", sub);
  // The attendee backs out while the Gemini session is still opening — the
  // realistic case, since session setup is real network I/O. `release()`
  // has nothing to act on yet: there is no Entry for "en".
  manager.release("en", sub);

  resolve(new FakeTranslateSession("en"));
  const lane = await acquiring;

  // The session was already being created when the attendee backed out, so
  // that lane still opens — that cost is sunk. What must not happen is
  // `sub` becoming a permanent phantom subscriber: since `sub` is
  // per-connection and will never call release() again, only an
  // immediately-armed grace timer on the empty lane stands between this
  // and it billing for the rest of the event.
  clock.advance(60000);

  assert.equal(
    hub.laneCount,
    0,
    "the lane must be torn down once its grace period passes, not left open by a phantom subscriber",
  );
  assert.equal(lane.state, "error", "the actual Gemini session must be closed, not just deregistered");
});
