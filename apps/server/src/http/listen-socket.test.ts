import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerMessage } from "@tongyeok/protocol";
import { FakeClock } from "../clock.ts";
import { AudioHub } from "../audio-hub.ts";
import { createFakeTranslateSessionFactory, FakeTranslateSession } from "../gemini/fake-translate-session.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { LaneManager } from "../lane/lane-manager.ts";
import { ListenSocket, type ListenWebSocket } from "./listen-socket.ts";

class FakeWs implements ListenWebSocket {
  sent: ServerMessage[] = [];
  closedWith: number | undefined;
  private handlers = new Map<string, () => void>();
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(code?: number): void { this.closedWith = code; }
  on(event: "close", fn: () => void): void { this.handlers.set(event, fn); }
  emit(event: string): void { this.handlers.get(event)?.(); }
}

/**
 * A session factory the test controls by hand: the returned promise only
 * resolves when `resolve` is called. Mirrors `deferredSessionFactory` in
 * `lane-manager.test.ts` — this is how the "listener disconnects while the
 * Gemini session is still opening" test below holds `acquire()` in flight.
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
  const hub = new AudioHub();
  const manager = new LaneManager({
    clock: new FakeClock(),
    hub,
    sessionFactory,
    sourceLanguage: "ko",
    offeredLanguages: ["ko", "en"],
    maxConcurrentLanes: 6,
    laneGraceMs: 60000,
    transcriptHistoryLines: 200,
    opusBitrate: 24000,
  });
  return { hub, manager, socket: new ListenSocket({ manager }) };
}

test("greets with hello, history and lane state", async () => {
  const { socket } = setup();
  const ws = new FakeWs();
  await socket.handleConnection(ws, "en");

  assert.deepEqual(ws.sent.map((m) => m.type), ["hello", "history", "lane"]);
});

test("pushes transcripts as they are published", async () => {
  const { hub, socket } = setup();
  const ws = new FakeWs();
  await socket.handleConnection(ws, "en");

  for (let i = 0; i < 25; i++) hub.push(Buffer.alloc(640));

  const transcripts = ws.sent.filter((m) => m.type === "transcript");
  assert.equal(transcripts.length, 1);
  assert.equal((transcripts[0] as { line: { text: string } }).line.text, "en utterance 1");
});

test("replays history to a late joiner", async () => {
  const { hub, socket } = setup();
  const first = new FakeWs();
  await socket.handleConnection(first, "en");
  for (let i = 0; i < 50; i++) hub.push(Buffer.alloc(640));

  const late = new FakeWs();
  await socket.handleConnection(late, "en");

  const history = late.sent.find((m) => m.type === "history");
  assert.deepEqual(
    (history as { lines: Array<{ text: string }> }).lines.map((l) => l.text),
    ["en utterance 1", "en utterance 2"],
  );
});

test("sends an error and closes for an unknown language", async () => {
  const { socket } = setup();
  const ws = new FakeWs();
  await socket.handleConnection(ws, "xx");

  assert.equal(ws.sent[0]!.type, "error");
  assert.equal(ws.closedWith, 4404);
});

test("closing releases the lane subscription", async () => {
  const { manager, socket } = setup();
  const ws = new FakeWs();
  await socket.handleConnection(ws, "en");
  assert.equal(manager.statuses()[0]!.listeners, 1);

  ws.emit("close");
  assert.equal(manager.statuses()[0]!.listeners, 0);
});

test("an unexpected acquire failure closes the socket instead of leaving it hanging open", async (t) => {
  const { manager, socket } = setup();
  const errorMock = t.mock.method(console, "error", () => {});

  // closeAll() makes every subsequent acquire() reject with a plain Error
  // ("LaneManager is closed") — neither UnknownLanguageError nor
  // LaneCapError. There is no HTTP status to fall back to here (unlike
  // StreamRoute's 500), so the WebSocket equivalent is closing with a
  // generic error code instead of letting the rejection escape and leave
  // the attendee connected with no explanation and no lane forthcoming.
  manager.closeAll();

  const ws = new FakeWs();
  await socket.handleConnection(ws, "ko");

  assert.equal(ws.closedWith, 1011);
  assert.equal(errorMock.mock.callCount(), 1);
});

test("a listener who disconnects while the lane is still opening does not leak the subscription", async () => {
  const { factory, resolve } = deferredSessionFactory();
  const { manager, socket } = setup(factory);
  const ws = new FakeWs();

  // Registering the "close" handler must happen before awaiting acquire(),
  // not after it resolves: otherwise a disconnect that arrives while the
  // Gemini session is still opening (real network I/O) fires no handler at
  // all, and nothing ever calls release() for this subscriber — a live,
  // billing session leaked for the rest of the event. That is exactly the
  // bug two earlier tasks in this plan shipped.
  const connecting = socket.handleConnection(ws, "en");
  ws.emit("close");

  resolve(new FakeTranslateSession("en"));
  await connecting;

  assert.equal(
    manager.statuses()[0]!.listeners,
    0,
    "the lane must not be left with a phantom subscriber that will never release again",
  );
});
