import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioHub } from "../audio-hub.ts";
import { IngestGateway, type WebSocketLike } from "./ingest-gateway.ts";
import type { PcmConsumer } from "../lane/lane.ts";

class FakeSocket implements WebSocketLike {
  closedWith: number | undefined;
  protected handlers = new Map<string, (arg: any) => void>();
  on(event: string, fn: (arg: any) => void): void { this.handlers.set(event, fn); }
  close(code?: number): void { this.closedWith = code; }
  emit(event: string, arg?: unknown): void { this.handlers.get(event)?.(arg); }
}

/**
 * A real socket may invoke its own "close" handler synchronously, inline
 * within the `close()` call, rather than on a later tick. The
 * supersede-then-reassign ordering in `handleConnection` must survive this
 * too, not just the late/async close a plain `FakeSocket` exercises.
 */
class SyncCloseFakeSocket extends FakeSocket {
  override close(code?: number): void {
    this.closedWith = code;
    this.handlers.get("close")?.(undefined);
  }
}

class SpyLane implements PcmConsumer {
  received: Buffer[] = [];
  laneDrops = 0;
  readonly lang = "en";
  pushPcm(frame: Buffer): void { this.received.push(frame); }
}

const url = (token: string) => new URL(`ws://x/ingest?token=${token}`);

test("rejects a bad token", () => {
  const gw = new IngestGateway({ hub: new AudioHub(), token: "secret" });
  const ws = new FakeSocket();
  gw.handleConnection(ws, url("wrong"));
  assert.equal(ws.closedWith, 4401);
  assert.equal(gw.connected, false);
});

test("forwards correctly sized frames to the hub", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const ws = new FakeSocket();

  gw.handleConnection(ws, url("secret"));
  ws.emit("message", Buffer.alloc(640));

  assert.equal(lane.received.length, 1);
  assert.equal(gw.framesReceived, 1);
});

test("ignores a frame of the wrong size", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const ws = new FakeSocket();

  gw.handleConnection(ws, url("secret"));
  ws.emit("message", Buffer.alloc(639));

  assert.equal(lane.received.length, 0);
  assert.equal(gw.framesReceived, 0);
  assert.equal(gw.framesDropped, 1);
});

test("forwards a frame delivered as an ArrayBuffer (non-default binaryType)", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const ws = new FakeSocket();

  gw.handleConnection(ws, url("secret"));
  const arrayBuffer = new ArrayBuffer(640);
  ws.emit("message", arrayBuffer);

  assert.equal(lane.received.length, 1);
  assert.equal(gw.framesReceived, 1);
  assert.equal(gw.framesDropped, 0);
});

test("forwards a frame delivered as fragments (Buffer[])", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const ws = new FakeSocket();

  gw.handleConnection(ws, url("secret"));
  ws.emit("message", [Buffer.alloc(320), Buffer.alloc(320)]);

  assert.equal(lane.received.length, 1);
  assert.equal(gw.framesReceived, 1);
  assert.equal(gw.framesDropped, 0);
});

test("a payload that fails conversion is counted as dropped, not thrown", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const ws = new FakeSocket();

  gw.handleConnection(ws, url("secret"));

  // A "fragments" array containing a non-Buffer element is something
  // Buffer.concat cannot handle and throws on. Conversion must fail closed
  // (dropped) rather than let the exception escape the message handler and
  // tear down the ingest connection.
  assert.doesNotThrow(() => ws.emit("message", ["not a buffer"]));

  assert.equal(lane.received.length, 0);
  assert.equal(gw.framesReceived, 0);
  assert.equal(gw.framesDropped, 1);
});

test("a reconnecting operator takes over and the stale socket is closed", () => {
  const gw = new IngestGateway({ hub: new AudioHub(), token: "secret" });
  const first = new FakeSocket();
  const second = new FakeSocket();

  gw.handleConnection(first, url("secret"));
  gw.handleConnection(second, url("secret"));

  assert.equal(first.closedWith, 4409);
  assert.equal(gw.connected, true);
});

test("a stale socket's close event after takeover does not clear the active connection", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const first = new FakeSocket();
  const second = new FakeSocket();

  gw.handleConnection(first, url("secret"));
  gw.handleConnection(second, url("secret"));
  // The old socket's close event lands late, after the takeover already
  // happened. It must not wipe out the live (second) connection.
  first.emit("close");

  assert.equal(gw.connected, true);

  // The live connection must still be able to deliver frames.
  second.emit("message", Buffer.alloc(640));
  assert.equal(lane.received.length, 1);
  assert.equal(gw.framesReceived, 1);
});

test("a frame that arrives on a superseded socket after takeover is not forwarded", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const first = new FakeSocket();
  const second = new FakeSocket();

  gw.handleConnection(first, url("secret"));
  gw.handleConnection(second, url("secret"));

  // A frame already in flight on the old connection arrives after the
  // takeover. It must be dropped, not mixed into the live PCM stream.
  first.emit("message", Buffer.alloc(640));

  assert.equal(lane.received.length, 0);
  assert.equal(gw.framesReceived, 0);

  // The new connection is unaffected and still forwards normally.
  second.emit("message", Buffer.alloc(640));
  assert.equal(lane.received.length, 1);
  assert.equal(gw.framesReceived, 1);
});

test("a synchronous close on the stale socket during takeover still leaves the new connection active", () => {
  const hub = new AudioHub();
  const lane = new SpyLane();
  hub.addLane(lane);
  const gw = new IngestGateway({ hub, token: "secret" });
  const first = new SyncCloseFakeSocket();
  const second = new FakeSocket();

  gw.handleConnection(first, url("secret"));
  // `handleConnection` calls `first.close(4409, ...)`, and this fake socket
  // invokes its own "close" handler inline, before `handleConnection` has
  // reassigned `active` to `second`. The takeover must still win.
  gw.handleConnection(second, url("secret"));

  assert.equal(first.closedWith, 4409);
  assert.equal(gw.connected, true);

  second.emit("message", Buffer.alloc(640));
  assert.equal(lane.received.length, 1);
  assert.equal(gw.framesReceived, 1);
});
