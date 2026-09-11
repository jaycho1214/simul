import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import {
  createFakeTranslateSessionFactory,
  FakeTranslateSession,
} from "../gemini/fake-translate-session.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import {
  LaneManager,
  LaneCapError,
  PASSTHROUGH_LANG,
  UnknownLanguageError,
} from "./lane-manager.ts";

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
  const factory: TranslateSessionFactory = () =>
    new Promise((res) => {
      resolve = res;
    });
  return { factory, resolve: (session) => resolve(session) };
}

function makeManager(
  overrides: Partial<{
    maxConcurrentLanes: number;
    laneGraceMs: number;
    passthroughLane: boolean;
  }> = {},
) {
  return makeManagerWithFactory(createFakeTranslateSessionFactory(), overrides);
}

/**
 * Builds a manager against a caller-supplied session factory, so tests that
 * need to control exactly when a Gemini session "finishes opening" (via
 * `deferredSessionFactory` below) can hold a `LaneManager` mid-acquire.
 */
function makeManagerWithFactory(
  sessionFactory: TranslateSessionFactory,
  overrides: Partial<{
    maxConcurrentLanes: number;
    laneGraceMs: number;
    passthroughLane: boolean;
  }> = {},
) {
  const clock = new FakeClock();
  const hub = new AudioHub();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory,
    passthroughLane: overrides.passthroughLane ?? false,
    offeredLanguages: ["ko", "en", "es", "ja", "fr", "de", "zh"],
    maxConcurrentLanes: overrides.maxConcurrentLanes ?? 6,
    laneGraceMs: overrides.laneGraceMs ?? 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
    streamPrimeMs: 12000,
  });
  return { clock, hub, manager };
}

test("opens a lane on the first subscriber and registers it with the hub", async () => {
  const { hub, manager } = makeManager();
  await manager.acquire("en", {}, "transcript");
  assert.equal(hub.laneCount, 1);
});

test("a second subscriber reuses the same lane", async () => {
  const { hub, manager } = makeManager();
  const a = await manager.acquire("en", {}, "transcript");
  const b = await manager.acquire("en", {}, "transcript");
  assert.equal(a, b);
  assert.equal(hub.laneCount, 1);
});

test("concurrent acquires of the same language open only one lane", async () => {
  const { hub, manager } = makeManager();
  const [a, b] = await Promise.all([
    manager.acquire("en", {}, "transcript"),
    manager.acquire("en", {}, "transcript"),
  ]);
  assert.equal(a, b);
  assert.equal(hub.laneCount, 1);
});

test("the lane survives until the grace period expires", async () => {
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const sub = {};
  await manager.acquire("en", sub, "transcript");
  manager.release("en", sub);

  clock.advance(59999);
  assert.equal(hub.laneCount, 1, "still alive inside the grace window");

  clock.advance(1);
  assert.equal(hub.laneCount, 0, "torn down once grace expires");
});

test("re-acquiring within the grace period cancels teardown", async () => {
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const sub = {};
  await manager.acquire("en", sub, "transcript");
  manager.release("en", sub);
  clock.advance(30000);
  await manager.acquire("en", {}, "transcript");
  clock.advance(60000);

  assert.equal(hub.laneCount, 1);
});

test("every offered language is a translated lane, the room's own included", async () => {
  const { manager } = makeManager();
  const lane = await manager.acquire("ko", {}, "transcript");
  assert.equal(lane.constructor.name, "TranslatedLane");
});

test("the passthrough lane costs no session, but only exists when turned on", async () => {
  const on = makeManager({ passthroughLane: true });
  const lane = await on.manager.acquire(PASSTHROUGH_LANG, {}, "transcript");
  assert.equal(lane.constructor.name, "SourceLane");

  const off = makeManager();
  await assert.rejects(
    () => off.manager.acquire(PASSTHROUGH_LANG, {}, "transcript"),
    UnknownLanguageError,
  );
});

test("rejects a language beyond the cap", async () => {
  const { manager } = makeManager({ maxConcurrentLanes: 2 });
  await manager.acquire("en", {}, "transcript");
  await manager.acquire("es", {}, "transcript");
  await assert.rejects(() => manager.acquire("ja", {}, "transcript"), LaneCapError);
});

test("rejects a language that is not offered", async () => {
  const { manager } = makeManager();
  await assert.rejects(() => manager.acquire("xx", {}, "transcript"), UnknownLanguageError);
});

test("statuses report listener counts and drops", async () => {
  const { manager } = makeManager();
  await manager.acquire("en", {}, "transcript");
  await manager.acquire("en", {}, "transcript");

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
    manager.acquire("en", {}, "transcript"),
    manager.acquire("es", {}, "transcript"),
    manager.acquire("ja", {}, "transcript"),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 2);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]!.status === "rejected" && rejected[0]!.reason instanceof LaneCapError);
  assert.equal(
    hub.laneCount,
    2,
    "the cap must hold even when opens race, not just when sequential",
  );
});

test("closeAll closes every open lane and clears the hub", async () => {
  const { hub, manager } = makeManager();
  await manager.acquire("en", {}, "transcript");
  await manager.acquire("es", {}, "transcript");
  assert.equal(hub.laneCount, 2);

  manager.closeAll();

  assert.equal(hub.laneCount, 0);
  assert.equal(manager.get("en"), undefined);
  assert.equal(manager.get("es"), undefined);
});

test("closeAll cancels pending grace timers, not just closes lanes", async (t) => {
  const { clock, hub, manager } = makeManager({ laneGraceMs: 60000 });
  const sub = {};
  await manager.acquire("en", sub, "transcript");
  // The lane keeps its own housekeeping timers on this clock too (see
  // TranslatedLane.scheduleFill), so the grace timer is identified by its
  // handle rather than by counting cancellations.
  const setTimeoutSpy = t.mock.method(clock, "setTimeout");
  manager.release("en", sub); // schedules a grace timer due at t=60000
  const graceTimer = setTimeoutSpy.mock.calls.find((call) => call.arguments[1] === 60000);
  assert.ok(graceTimer, "release() scheduled the grace timer");

  const clearTimeoutSpy = t.mock.method(clock, "clearTimeout");
  manager.closeAll();

  assert.ok(
    clearTimeoutSpy.mock.calls.some((call) => call.arguments[0] === graceTimer.result),
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
  const { factory, resolve } = deferredSessionFactory();
  const { hub, manager } = makeManagerWithFactory(factory);

  const acquiring = manager.acquire("en", {}, "transcript");
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
  assert.equal(
    lane.state,
    "error",
    "the session created after closeAll() must be closed, not left live",
  );
});

test("release() before the open resolves does not create a phantom subscriber", async () => {
  const { factory, resolve } = deferredSessionFactory();
  const { clock, hub, manager } = makeManagerWithFactory(factory);

  const sub = {};
  const acquiring = manager.acquire("en", sub, "transcript");
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
  assert.equal(
    lane.state,
    "error",
    "the actual Gemini session must be closed, not just deregistered",
  );
});

// The following two tests came out of a second review round on the fix
// above. Reconciling a subscriber whose release arrived mid-open needs to
// both add them to `entry.subscribers` *and* clear whatever grace timer an
// earlier subscriber's own reconciliation may have already armed on the
// same entry — otherwise a joiner who legitimately stays behind is added
// next to a live timer handle nobody ever cancels, and once they are the
// last one out, release()'s "a timer is already pending" guard reads that
// dead handle as real and never arms a working one in its place.

test("a joiner who stays after the owner releases mid-open is not blocked by a zombie grace timer", async () => {
  const { factory, resolve } = deferredSessionFactory();
  const { clock, hub, manager } = makeManagerWithFactory(factory);

  const owner = {};
  const joiner = {};

  // Owner opens "en"; joiner arrives while it is still opening and joins
  // the same in-flight open (the "Collapse concurrent ... races" path).
  const ownerAcquiring = manager.acquire("en", owner, "transcript");
  const joinerAcquiring = manager.acquire("en", joiner, "transcript");

  // Owner backs out before the session finishes opening.
  manager.release("en", owner);

  resolve(new FakeTranslateSession("en"));
  const [ownerLane, joinerLane] = await Promise.all([ownerAcquiring, joinerAcquiring]);
  assert.equal(ownerLane, joinerLane);

  // At this point the owner's reconciliation has already armed a grace
  // timer (subscribers momentarily hit zero) and the joiner's own
  // reconciliation must have cancelled it on arrival. Advancing past the
  // original grace period proves that: the joiner is still subscribed, so
  // the lane must still be open.
  clock.advance(60000);
  assert.equal(
    hub.laneCount,
    1,
    "the joiner is still listening; a stale timer must not have torn the lane down",
  );

  // Now the joiner leaves for real — the only real release this lane has
  // ever had with nobody left subscribed.
  manager.release("en", joiner);
  clock.advance(60000);

  assert.equal(
    hub.laneCount,
    0,
    "the lane must actually close once its only remaining subscriber releases, not stay open forever behind a dead timer handle",
  );
  assert.equal(
    joinerLane.state,
    "error",
    "the Gemini session itself must be closed, not just deregistered",
  );
});

test("a joiner's own release starts a fresh grace period, not a stale one inherited from the owner", async () => {
  // A narrower check than the zombie-timer test above: even once the
  // zombie handle is fixed by clearing it *when it eventually fires*, a
  // joiner whose own subscription is never used to clear the timer on
  // arrival can still have their real departure silently governed by the
  // owner's leftover deadline instead of their own — closing the lane
  // sooner (never later) than laneGraceMs after the joiner's own release.
  // That is not a spend leak, but it is exactly the kind of "grace period
  // isn't actually laneGraceMs" bug this invariant exists to rule out.
  const { factory, resolve } = deferredSessionFactory();
  const { clock, hub, manager } = makeManagerWithFactory(factory, { laneGraceMs: 60000 });

  const owner = {};
  const joiner = {};

  const ownerAcquiring = manager.acquire("en", owner, "transcript");
  const joinerAcquiring = manager.acquire("en", joiner, "transcript");
  manager.release("en", owner); // arms a timer, due at t=60000, once the open resolves

  resolve(new FakeTranslateSession("en"));
  await Promise.all([ownerAcquiring, joinerAcquiring]);

  clock.advance(30000); // t=30000, well before the owner's stale deadline
  manager.release("en", joiner); // the joiner's own, real departure

  clock.advance(40000); // t=70000: past the stale t=60000 mark, short of a fresh t=90000 mark
  assert.equal(
    hub.laneCount,
    1,
    "a full laneGraceMs from the joiner's own release must not be cut short by a timer armed for someone else's earlier departure",
  );

  clock.advance(20000); // t=90000: a full laneGraceMs after the joiner's own release
  assert.equal(hub.laneCount, 0);
});

test("acquire() after closeAll() rejects without opening a new session", async () => {
  let factoryCalls = 0;
  const sessionFactory: TranslateSessionFactory = async (opts) => {
    factoryCalls++;
    return new FakeTranslateSession(opts.targetLanguage);
  };
  const { hub, manager } = makeManagerWithFactory(sessionFactory);

  manager.closeAll();

  await assert.rejects(() => manager.acquire("en", {}, "transcript"));
  assert.equal(
    factoryCalls,
    0,
    "a closed manager must not open a new Gemini session at all, not open-then-close it",
  );
  assert.equal(hub.laneCount, 0);
});

test("statuses count people, not transports", async () => {
  const { manager } = makeManager();

  // One attendee's phone holds two subscriptions to the same lane at once:
  // the chunked /stream response carrying the audio, and the /listen socket
  // carrying the transcript. Counting subscriptions reported three attendees
  // as six.
  const attendees = [
    { audio: {}, transcript: {} },
    { audio: {}, transcript: {} },
    { audio: {}, transcript: {} },
  ];
  for (const attendee of attendees) {
    await manager.acquire("en", attendee.audio, "audio");
    await manager.acquire("en", attendee.transcript, "transcript");
  }

  const [status] = manager.statuses();
  assert.equal(status!.listeners, 3, "three people in the room, not six sockets");
  assert.equal(status!.audioListeners, 3);

  // One of them mutes: the audio stream ends, the page stays open. A head
  // count that wobbles when nobody left is a number the operator cannot act
  // on, so the headline figure must hold — while the audio figure, which is
  // the one that actually moved, shows what happened.
  manager.release("en", attendees[0]!.audio);
  const [afterMute] = manager.statuses();
  assert.equal(afterMute!.listeners, 3, "muting is not leaving");
  assert.equal(afterMute!.audioListeners, 2, "but the operator can see who is still hearing audio");

  // And one of them actually leaves, closing both.
  manager.release("en", attendees[1]!.audio);
  manager.release("en", attendees[1]!.transcript);
  const [afterLeaving] = manager.statuses();
  assert.equal(afterLeaving!.listeners, 2);
  assert.equal(afterLeaving!.audioListeners, 1);
});

test("statuses count a client that only ever pulls audio", async () => {
  const { manager } = makeManager();
  await manager.acquire("en", {}, "audio");

  const [status] = manager.statuses();
  assert.equal(status!.listeners, 1, "a bare /stream URL in a media player is still a listener");
  assert.equal(status!.audioListeners, 1);
});

// The bill for a lane does not stop being real when the lane closes, and the
// operator's meter is read over a whole event, across lanes opening and
// closing as people come and go. So the total carries retired lanes.
test("usage totals every lane that ever cost anything, open or already closed", async () => {
  const sessions: FakeTranslateSession[] = [];
  const { clock, manager } = makeManagerWithFactory(
    createFakeTranslateSessionFactory((s) => sessions.push(s)),
    { laneGraceMs: 1000 },
  );
  clock.advance(5_000);
  const sub = {};
  await manager.acquire("en", sub, "transcript");
  sessions[0]!.simulateUsage({ inputAudioTokens: 100, outputAudioTokens: 50 });
  assert.deepEqual(manager.usage(), {
    since: 0,
    languages: [{ lang: "en", inputAudioTokens: 100, outputAudioTokens: 50 }],
  });

  manager.release("en", sub);
  clock.advance(1000);
  assert.equal(manager.statuses().length, 0, "the lane closed after grace");
  assert.deepEqual(manager.usage().languages, [
    { lang: "en", inputAudioTokens: 100, outputAudioTokens: 50 },
  ]);

  await manager.acquire("en", {}, "transcript");
  sessions[1]!.simulateUsage({ inputAudioTokens: 25, outputAudioTokens: 25 });
  assert.deepEqual(manager.usage().languages, [
    { lang: "en", inputAudioTokens: 125, outputAudioTokens: 75 },
  ]);

  manager.closeAll();
  assert.deepEqual(manager.usage().languages, [
    { lang: "en", inputAudioTokens: 125, outputAudioTokens: 75 },
  ]);
});
