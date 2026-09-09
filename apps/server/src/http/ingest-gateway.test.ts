import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioHub } from "../audio-hub.ts";
import { IngestGateway, type WebSocketLike } from "./ingest-gateway.ts";
import type { PcmConsumer } from "../lane/lane.ts";

class FakeSocket implements WebSocketLike {
  closedWith: number | undefined;
  private handlers = new Map<string, (arg: any) => void>();
  on(event: string, fn: (arg: any) => void): void { this.handlers.set(event, fn); }
  close(code?: number): void { this.closedWith = code; }
  emit(event: string, arg?: unknown): void { this.handlers.get(event)?.(arg); }
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
