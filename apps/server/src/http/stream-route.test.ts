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
  private handlers = new Map<string, () => void>();

  writeHead(code: number, headers?: Record<string, string>) {
    this.statusCode = code;
    if (headers) this.headers = headers;
    return this;
  }
  write(chunk: Buffer) { this.written.push(chunk); return true; }
  end(_?: unknown) { this.ended = true; return this; }
  on(event: string, fn: () => void) { this.handlers.set(event, fn); return this; }
  emit(event: string) { this.handlers.get(event)?.(); }
}

/**
 * Simulates a response whose socket is already gone by the time the route
 * tries to write the init segment: `writeHead` succeeds (as it would on a
 * real socket that hasn't yet noticed the peer is dead) but the first
 * `write` throws, after headers are already sent.
 */
class ThrowsOnWriteResponse extends FakeResponse {
  override write(_chunk: Buffer): boolean {
    throw new Error("socket destroyed");
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

test("releases the lane if streaming setup throws after acquire succeeds", async (t) => {
  const { manager, route } = setup();
  t.mock.method(console, "error", () => {});

  // If anything throws between acquire() succeeding and the "close" handler
  // being registered, that handler never gets attached — so it can never
  // fire to release the lane. Without a safety net here, this leaks a live
  // (and, for a translated lane, billing) Gemini session subscription for
  // the rest of the event: nothing else is ever going to call release() for
  // this subscriber again.
  const res = new ThrowsOnWriteResponse();
  await route.handle(res as any, "ko");

  const status = manager.statuses().find((s) => s.lang === "ko");
  assert.equal(status?.listeners, 0);
});
