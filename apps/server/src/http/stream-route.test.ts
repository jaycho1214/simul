import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import { createFakeTranslateSessionFactory, FakeTranslateSession } from "../gemini/fake-translate-session.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { LaneManager } from "../lane/lane-manager.ts";
import { StreamRoute } from "./stream-route.ts";

class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  written: Buffer[] = [];
  writableLength = 0;
  ended = false;
  /**
   * Mirrors Node's real `OutgoingMessage`: header bytes aren't actually
   * flushed by `writeHead` alone — they go out lazily, inside `_send()`,
   * the first time `write()` (or `end()`) runs. `_send()` flips
   * `_headerSent` to `true` *before* the `_writeRaw` call that can throw on
   * a dead socket. So a `write()` failure in production always happens
   * with `headersSent` already `true` — a subclass simulating that failure
   * must set it before throwing, same as here.
   */
  headersSent = false;
  private handlers = new Map<string, () => void>();

  writeHead(code: number, headers?: Record<string, string>) {
    this.statusCode = code;
    if (headers) this.headers = headers;
    return this;
  }
  write(chunk: Buffer) {
    this.headersSent = true;
    this.written.push(chunk);
    return true;
  }
  end(_?: unknown) { this.ended = true; return this; }
  on(event: string, fn: () => void) { this.handlers.set(event, fn); return this; }
  emit(event: string) { this.handlers.get(event)?.(); }
}

/**
 * Simulates a response whose socket is already gone by the time the route
 * tries to write the init segment: `writeHead` succeeds (as it would on a
 * real socket that hasn't yet noticed the peer is dead) but the first
 * `write` throws. `headersSent` is set to `true` first, matching Node's
 * real ordering (see `FakeResponse.headersSent` above) — this is the
 * branch that actually runs at a live event: the route must fall back to
 * `res.end()`, not attempt a second `writeHead`.
 */
class ThrowsOnWriteResponse extends FakeResponse {
  override write(_chunk: Buffer): boolean {
    this.headersSent = true;
    throw new Error("socket destroyed");
  }
}

/**
 * Simulates a failure *before* any header bytes are sent: the very first
 * `writeHead` call throws (e.g. a synchronous validation error unrelated to
 * the socket), so `headersSent` is still `false` when the route's recovery
 * path runs. A later `writeHead` call — the route's own `respondError`
 * retry — succeeds, standing in for a still-usable connection.
 */
class ThrowsOnFirstWriteHeadResponse extends FakeResponse {
  private calls = 0;
  override writeHead(code: number, headers?: Record<string, string>) {
    this.calls++;
    if (this.calls === 1) throw new Error("failed to send headers");
    return super.writeHead(code, headers);
  }
}

/**
 * A session factory the test controls by hand: the returned promise only
 * resolves when `resolve` is called. Mirrors `deferredSessionFactory` in
 * `lane-manager.test.ts` and `listen-socket.test.ts` — this is how the
 * "client disconnects while the Gemini session is still opening" test below
 * holds `acquire()` in flight.
 */
function deferredSessionFactory(): {
  factory: TranslateSessionFactory;
  resolve: (session: TranslateSession) => void;
} {
  let resolve!: (session: TranslateSession) => void;
  const factory: TranslateSessionFactory = () => new Promise((res) => { resolve = res; });
  return { factory, resolve: (session) => resolve(session) };
}

function setup(sessionFactory: TranslateSessionFactory = createFakeTranslateSessionFactory()) {
  const clock = new FakeClock();
  const hub = new AudioHub();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory,
    sourceLanguage: "ko",
    offeredLanguages: ["ko", "en"],
    maxConcurrentLanes: 6,
    laneGraceMs: 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
  });
  return { clock, hub, manager, route: new StreamRoute({ manager }) };
}

test("sends the init segment first with audio/webm headers", async () => {
  const { route } = setup();
  const res = new FakeResponse();
  await route.handle(res as any, "ko");

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "audio/webm");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.ok(res.written[0]!.includes(Buffer.from("OpusHead")));
});

test("streams clusters as ingest audio arrives", async () => {
  const { hub, route } = setup();
  const res = new FakeResponse();
  await route.handle(res as any, "ko");
  const afterInit = res.written.length;

  for (let i = 0; i < 5; i++) hub.push(Buffer.alloc(640));
  assert.ok(res.written.length > afterInit, "a cluster reached the client");
});

test("404s an unknown language", async () => {
  const { route } = setup();
  const res = new FakeResponse();
  await route.handle(res as any, "xx");
  assert.equal(res.statusCode, 404);
});

test("drops clusters for a backed-up client instead of buffering", async () => {
  const { hub, route } = setup();
  const res = new FakeResponse();
  await route.handle(res as any, "ko");
  const afterInit = res.written.length;

  res.writableLength = 100_000; // past the 64 KB threshold
  for (let i = 0; i < 20; i++) hub.push(Buffer.alloc(640));

  assert.equal(res.written.length, afterInit, "nothing was written while backed up");
  assert.ok(route.listenerDrops("ko") > 0);
});

test("an unexpected acquire failure still answers the request instead of hanging forever", async (t) => {
  const { manager, route } = setup();
  const errorMock = t.mock.method(console, "error", () => {});

  // closeAll() makes every subsequent acquire() reject with a plain Error
  // ("LaneManager is closed") — neither UnknownLanguageError nor
  // LaneCapError, exactly the "anything else" branch the brief's sample
  // rethrows. The server wires this route as `void streamRoute.handle(...)`
  // (see task-16-brief.md), so a rejection that escapes here becomes an
  // unhandled promise rejection instead of a response: the client is left
  // with an open connection and no bytes, and depending on Node's
  // unhandledRejection policy the whole process can go down over one bad
  // request. This route must guarantee a response on every path instead.
  manager.closeAll();

  const res = new FakeResponse();
  await route.handle(res as any, "ko");

  assert.equal(res.statusCode, 500);
  assert.ok(res.ended);
  assert.equal(errorMock.mock.callCount(), 1);
});

test("releases the lane and ends the response when write() fails after headers are sent", async (t) => {
  const { manager, route } = setup();
  t.mock.method(console, "error", () => {});

  // The "close" handler is registered before acquire() is even awaited (see
  // the leak-during-acquire tests below), so in practice it would eventually
  // release this lane on its own once res.end() below finishes tearing down
  // the connection. The explicit release() call in this catch is a second,
  // redundant-by-design line of defense — release() is idempotent, so
  // calling it here too costs nothing and covers a response object left in
  // some state where "close" isn't guaranteed to fire at all.
  //
  // This is also the branch that actually runs in production: headers are
  // already sent by the time write() throws (see ThrowsOnWriteResponse), so
  // the route must fall back to res.end() rather than a second writeHead —
  // and the client must still be answered (the connection closed out), not
  // just have its lane silently released.
  const res = new ThrowsOnWriteResponse();
  await route.handle(res as any, "ko");

  const status = manager.statuses().find((s) => s.lang === "ko");
  assert.equal(status?.listeners, 0, "the lane subscription was released");
  assert.equal(res.statusCode, 200, "no second writeHead was attempted once headers were sent");
  assert.ok(res.ended, "the response was closed out, not left hanging");
});

test("releases the lane and answers with 500 when setup fails before headers are sent", async (t) => {
  const { manager, route } = setup();
  t.mock.method(console, "error", () => {});

  // The mirror case: headers were never sent, so the recovery path can and
  // must still answer with a real error status instead of just ending a
  // response that was never started. Covering both branches matters
  // because FakeResponse previously had no headersSent tracking at all —
  // every failure looked like "headers not sent" to the route, so this
  // 500-retry branch was the only one any test ever exercised, even though
  // it's the res.end() branch above that runs at a live event.
  const res = new ThrowsOnFirstWriteHeadResponse();
  await route.handle(res as any, "ko");

  const status = manager.statuses().find((s) => s.lang === "ko");
  assert.equal(status?.listeners, 0, "the lane subscription was released");
  assert.equal(res.statusCode, 500);
  assert.ok(res.ended);
});

test("a client that disconnects while the lane is still opening does not leak the subscription", async () => {
  const { factory, resolve } = deferredSessionFactory();
  const { clock, hub, manager, route } = setup(factory);
  const res = new FakeResponse();

  // "en" is a translated lane, so acquiring it is real network I/O (opening
  // a Gemini session) and genuinely takes time to settle — unlike "ko" (the
  // source language), which resolves synchronously with no session at all.
  // Registering the "close" handler must happen before awaiting acquire(),
  // not after it resolves: otherwise a disconnect that arrives during that
  // window — a phone locked, a tab closed, a language switched — fires no
  // handler at all, and nothing ever calls release() for this subscriber.
  // That is the exact bug two earlier tasks in this plan shipped, and the
  // one Task 15 caught for ListenSocket before it shipped a third time here.
  const handling = route.handle(res as any, "en");
  res.emit("close");

  resolve(new FakeTranslateSession("en"));
  await handling;

  const afterAcquire = manager.statuses().find((s) => s.lang === "en");
  assert.equal(
    afterAcquire?.listeners,
    0,
    "the lane must not be left with a phantom subscriber that will never release again",
  );

  // A dropped refcount alone isn't proof of anything if the lane were, say,
  // never actually opened, or the grace timer never got armed. Advance past
  // the grace period and confirm the lane is fully torn down — removed from
  // both the manager and the hub — the same as any other listener leaving.
  clock.advance(60_000);
  assert.equal(manager.statuses().find((s) => s.lang === "en"), undefined, "the lane was torn down");
  assert.equal(hub.laneCount, 0, "the hub no longer holds the torn-down lane");
});

test("a client that disconnects while the lane is still opening leaves no cluster subscription behind", async () => {
  const { factory, resolve } = deferredSessionFactory();
  const { hub, manager, route } = setup(factory);
  const res = new FakeResponse();

  // The refcount half of this is covered by the test above. This is the
  // other half, and the sixth occurrence of the shape in this project: the
  // unsubscribe handle is assigned *after* the await, so the close handler
  // that ran during the open unsubscribed nothing. The lane then writes
  // clusters into a dead response for the rest of its life, and the closure
  // keeps the response object alive with it.
  const handling = route.handle(res as any, "en");
  res.emit("close");

  resolve(new FakeTranslateSession("en"));
  await handling;

  assert.equal(res.statusCode, 0, "no headers were written to a response that had already closed");
  assert.deepEqual(res.written, [], "and no init segment either");

  // The lane is still open (the grace timer has not run), so it is still
  // producing clusters — exactly the condition a leaked subscription needs.
  for (let i = 0; i < 50; i++) hub.push(Buffer.alloc(640));
  assert.deepEqual(res.written, [], "no cluster subscription outlived the response");
  assert.equal(manager.statuses().find((s) => s.lang === "en")?.listeners, 0);
});
