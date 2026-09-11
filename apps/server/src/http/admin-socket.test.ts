import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdminMessage, LaneStatus } from "@simul/protocol";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import {
  createFakeTranslateSessionFactory,
  FakeTranslateSession,
} from "../gemini/fake-translate-session.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { LaneManager, PASSTHROUGH_LANG } from "../lane/lane-manager.ts";
import { StreamRoute } from "./stream-route.ts";
import { AdminSocket, type AdminWebSocket } from "./admin-socket.ts";

const PUSH_INTERVAL_MS = 1000;

class FakeAdminWs implements AdminWebSocket {
  readonly tables: LaneStatus[][] = [];
  private handlers = new Map<string, () => void>();

  send(data: string): void {
    const message = JSON.parse(data) as AdminMessage;
    assert.equal(message.type, "lanes");
    this.tables.push(message.lanes);
  }
  on(event: "close", fn: () => void): void {
    this.handlers.set(event, fn);
  }
  emit(event: string): void {
    this.handlers.get(event)?.();
  }

  /** The most recent table pushed, which is what the operator is looking at. */
  latest(): LaneStatus[] {
    const table = this.tables.at(-1);
    assert.ok(table, "the dashboard has been pushed at least one table");
    return table;
  }

  lane(lang: string): LaneStatus {
    const status = this.latest().find((l) => l.lang === lang);
    assert.ok(status, `the table contains a row for "${lang}"`);
    return status;
  }
}

/** A dashboard socket whose peer has already gone: every send throws. */
class DeadAdminWs extends FakeAdminWs {
  override send(_data: string): void {
    throw new Error("socket destroyed");
  }
}

/** Enough of a ServerResponse for StreamRoute to record listener drops. */
class FakeStreamResponse {
  writableLength = 0;
  written: Buffer[] = [];
  headersSent = false;
  writeHead() {
    return this;
  }
  write(chunk: Buffer) {
    this.headersSent = true;
    this.written.push(chunk);
    return true;
  }
  end() {
    return this;
  }
  on() {
    return this;
  }
}

/**
 * Opens exactly one working session and then hangs forever, so a lane whose
 * connection dies can never get a replacement. That is not a contrived
 * shape: it is a Gemini connect that has stalled, or an outbound network
 * that has gone away mid-event, and it is the state the operator most needs
 * the dashboard to be honest about.
 */
function oneSessionThenStalled(): {
  created: FakeTranslateSession[];
  factory: TranslateSessionFactory;
} {
  const created: FakeTranslateSession[] = [];
  const factory: TranslateSessionFactory = async ({ targetLanguage }) => {
    if (created.length > 0) return new Promise<TranslateSession>(() => {});
    const session = new FakeTranslateSession(targetLanguage);
    created.push(session);
    return session;
  };
  return { created, factory };
}

// Lets a real (macro)task boundary pass, so the rotation a session's own
// event handler kicks off with a fire-and-forget `void rotate()` settles.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Real signal, not Buffer.alloc silence: it has to survive a real encoder. */
function tone(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes);
  for (let s = 0; s < bytes / 2; s++) {
    buf.writeInt16LE(Math.round(8000 * Math.sin(s / 6)), s * 2);
  }
  return buf;
}

function setup(sessionFactory: TranslateSessionFactory = createFakeTranslateSessionFactory()) {
  const clock = new FakeClock();
  const hub = new AudioHub();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory,
    passthroughLane: true,
    offeredLanguages: ["ko", "en"],
    maxConcurrentLanes: 6,
    laneGraceMs: 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
    streamPrimeMs: 12000,
  });
  // A zero-byte buffer ceiling makes any pending write count as a backed-up
  // client, so listener drops can be produced without shovelling megabytes.
  const route = new StreamRoute({ manager, maxBufferedBytes: 0 });
  return {
    clock,
    hub,
    manager,
    route,
    socket: new AdminSocket({ manager, streamRoute: route, clock }),
  };
}

test("pushes a table immediately on connect and again on every interval", async () => {
  const { clock, manager, socket } = setup();
  await manager.acquire("en", {}, "transcript");

  const ws = new FakeAdminWs();
  socket.handleConnection(ws);
  assert.equal(ws.tables.length, 1, "the dashboard is not left blank until the first tick");

  clock.advance(PUSH_INTERVAL_MS);
  clock.advance(PUSH_INTERVAL_MS);
  assert.equal(ws.tables.length, 3);
  assert.deepEqual(
    ws.latest().map((l) => l.lang),
    ["en"],
  );
});

test("reports listener counts, lane age and per-language listener drops", async () => {
  const { clock, hub, manager, route, socket } = setup();

  const res = new FakeStreamResponse();
  await route.handle(res as any, PASSTHROUGH_LANG);
  await manager.acquire(PASSTHROUGH_LANG, {}, "transcript");

  // A client too backed up to take clusters: the route drops rather than
  // buffers, and that count is the operator's signal for "this listener's
  // network cannot keep up", distinct from the lane's own drops.
  res.writableLength = 1;
  for (let i = 0; i < 20; i++) hub.push(tone(640));

  clock.advance(500);
  const ws = new FakeAdminWs();
  socket.handleConnection(ws);

  const ko = ws.lane(PASSTHROUGH_LANG);
  assert.equal(ko.listeners, 1, "one attendee holding both transports is one listener");
  assert.equal(ko.audioListeners, 1);
  assert.ok(ko.listenerDrops > 0, "the stream route's drops reached the table");
  assert.equal(ko.ageMs, 500);
});

// ---------------------------------------------------------------------------
// Lane health. This is the whole reason the admin socket exists, and until
// this file was written nothing tested it at any level: a lane state that was
// wrong in both directions, permanently, survived a suite of 130 passing
// tests.
// ---------------------------------------------------------------------------

test("a lane that loses its session reads reconnecting, and live again once it recovers", async () => {
  const created: FakeTranslateSession[] = [];
  const { clock, hub, manager, socket } = setup(
    createFakeTranslateSessionFactory((s) => created.push(s)),
  );
  await manager.acquire("en", {}, "transcript");

  const ws = new FakeAdminWs();
  socket.handleConnection(ws);
  assert.equal(ws.lane("en").state, "starting");

  hub.push(tone(640));
  clock.advance(PUSH_INTERVAL_MS);
  assert.equal(ws.lane("en").state, "live");

  // Gemini drops a connection roughly every ten minutes, usually without
  // warning. The rotator handles it — but said nothing about it, so the
  // dashboard went on reading 실시간 through the gap.
  created[0]!.simulateDeath("connection reset");
  await flush();
  clock.advance(PUSH_INTERVAL_MS);
  assert.equal(ws.lane("en").state, "reconnecting");

  // And the recovery is a state change too. The replacement burns its single
  // "live" emission while it is still the replacement, so unless the
  // promotion re-announces, this lane reads 재연결 중 for the rest of the
  // event while working perfectly.
  for (let i = 0; i < 25; i++) hub.push(tone(640));
  clock.advance(PUSH_INTERVAL_MS);
  assert.equal(ws.lane("en").state, "live");
});

test("a lane with nowhere to put audio reports rising drops, not silent green", async () => {
  const { created, factory } = oneSessionThenStalled();
  const { clock, hub, manager, socket } = setup(factory);
  await manager.acquire("en", {}, "transcript");

  const ws = new FakeAdminWs();
  socket.handleConnection(ws);
  assert.equal(ws.lane("en").laneDrops, 0);

  created[0]!.simulateDeath("connection reset");
  await flush(); // the replacement is requested here, and never arrives

  for (let i = 0; i < 30; i++) hub.push(tone(640));
  clock.advance(PUSH_INTERVAL_MS);

  // Both halves matter. The state says the lane is down; the drop counter
  // says how much audio has been lost since. Reporting `canAccept()` as true
  // merely because a `current` reference still existed left this at 0 while
  // 100% of the lane's audio evaporated — the dashboard reading all green
  // over ten minutes of silence, which the spec's failure table says must
  // fail loudly on the operator dashboard, not silently per lane.
  const en = ws.lane("en");
  assert.equal(en.state, "reconnecting");
  assert.equal(en.laneDrops, 30, "every frame that went nowhere was counted");
});

test("the passthrough lane needs no session and reads live throughout", async () => {
  const { clock, hub, manager, socket } = setup();
  await manager.acquire(PASSTHROUGH_LANG, {}, "transcript");

  const ws = new FakeAdminWs();
  socket.handleConnection(ws);
  for (let i = 0; i < 10; i++) hub.push(tone(640));
  clock.advance(PUSH_INTERVAL_MS);

  const ko = ws.lane(PASSTHROUGH_LANG);
  assert.equal(ko.state, "live");
  assert.equal(ko.laneDrops, 0);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("pushes to every connected dashboard and stops once the last one leaves", async () => {
  const { clock, manager, socket } = setup();
  await manager.acquire("en", {}, "transcript");

  const first = new FakeAdminWs();
  const second = new FakeAdminWs();
  socket.handleConnection(first);
  socket.handleConnection(second);

  clock.advance(PUSH_INTERVAL_MS);
  const firstCount = first.tables.length;
  const secondCount = second.tables.length;
  assert.ok(firstCount > 1 && secondCount > 1, "both dashboards are being pushed to");

  first.emit("close");
  clock.advance(PUSH_INTERVAL_MS);
  assert.equal(first.tables.length, firstCount, "a departed dashboard is no longer written to");
  assert.ok(second.tables.length > secondCount, "the remaining one still is");

  // The timer must stop with the last client: an operator app that opens and
  // closes the dashboard repeatedly over a long event would otherwise leave a
  // rescheduling timer running per visit, serialising the lane table forever
  // for nobody.
  second.emit("close");
  const settled = second.tables.length;
  clock.advance(PUSH_INTERVAL_MS * 10);
  assert.equal(second.tables.length, settled, "nothing is pushed with no dashboards connected");
});

test("a dashboard whose socket has died is dropped rather than retried forever", async () => {
  const { clock, manager, socket } = setup();
  await manager.acquire("en", {}, "transcript");

  const dead = new DeadAdminWs();
  const alive = new FakeAdminWs();
  socket.handleConnection(dead);
  socket.handleConnection(alive);

  clock.advance(PUSH_INTERVAL_MS);
  assert.ok(alive.tables.length > 1, "one bad socket does not stop the others being served");

  // Dropping the dead one on its first failed write is what lets the timer
  // stop when the last real dashboard leaves.
  alive.emit("close");
  const settled = alive.tables.length;
  clock.advance(PUSH_INTERVAL_MS * 5);
  assert.equal(alive.tables.length, settled);
});

test("stop() is safe to call when nothing is scheduled", async () => {
  const { clock, manager, socket } = setup();
  await manager.acquire("en", {}, "transcript");

  socket.stop();
  const ws = new FakeAdminWs();
  socket.handleConnection(ws);
  socket.stop();
  socket.stop();

  clock.advance(PUSH_INTERVAL_MS * 5);
  assert.equal(ws.tables.length, 1, "stopped means stopped: only the connect-time push happened");
});
