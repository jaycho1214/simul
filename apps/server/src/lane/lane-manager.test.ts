import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import { createFakeTranslateSessionFactory } from "../gemini/fake-translate-session.ts";
import { LaneManager, LaneCapError, UnknownLanguageError } from "./lane-manager.ts";

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

test("closeAll cancels a pending grace timer so it cannot tear down a lane reopened later", async () => {
  // A grace timer left running past closeAll() is a live handle pointing at
  // a language, not at a specific lane instance. If closeAll() closes the
  // lane and clears its own bookkeeping but forgets to cancel the timer,
  // the timer is still armed. Should that language be reopened afterward
  // (e.g. the manager is reused, or this models "the old scheduled callback
  // is still queued"), the stale timer fires at its *original* due time and
  // tears down the new lane before that new lane's own grace period is up
  // — a listener silently cut off, not a leak, but exactly the "timer that
  // outlives a teardown" failure class called out as worth guarding.
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const subA = {};
  await manager.acquire("en", subA);
  manager.release("en", subA); // schedules a grace timer due at t=60000

  manager.closeAll(); // must cancel that timer, not just close the lane

  clock.advance(40000); // t=40000, still well before the stale timer's due time
  const subB = {};
  await manager.acquire("en", subB); // reopens a fresh lane at t=40000
  manager.release("en", subB); // schedules its OWN grace timer, due at t=100000

  clock.advance(20000); // t=60000 — exactly when the stale timer would have fired
  assert.equal(
    hub.laneCount,
    1,
    "a cancelled stale timer must not tear down the lane reopened after closeAll",
  );

  clock.advance(40000); // t=100000 — the reopened lane's own grace timer fires
  assert.equal(hub.laneCount, 0);
});
