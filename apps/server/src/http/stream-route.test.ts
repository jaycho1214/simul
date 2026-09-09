import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import { createFakeTranslateSessionFactory } from "../gemini/fake-translate-session.ts";
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

function setup() {
  const hub = new AudioHub();
  const manager = new LaneManager({
    clock: new FakeClock(),
    hub,
    sessionFactory: createFakeTranslateSessionFactory(),
    sourceLanguage: "ko",
    offeredLanguages: ["ko", "en"],
    maxConcurrentLanes: 6,
    laneGraceMs: 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
  });
  return { hub, manager, route: new StreamRoute({ manager }) };
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

  // If anything throws between acquire() succeeding and the "close" handler
  // being registered, that handler never gets attached — so it can never
  // fire to release the lane. Without a safety net here, this leaks a live
  // (and, for a translated lane, billing) Gemini session subscription for
  // the rest of the event: nothing else is ever going to call release() for
  // this subscriber again.
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
