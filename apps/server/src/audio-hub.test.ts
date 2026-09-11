import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioHub } from "./audio-hub.ts";
import type { PcmConsumer } from "./lane/lane.ts";

class SpyLane implements PcmConsumer {
  received: Buffer[] = [];
  laneDrops = 0;
  constructor(
    readonly lang: string,
    private readonly throws = false,
  ) {}
  pushPcm(frame: Buffer): void {
    if (this.throws) throw new Error("boom");
    this.received.push(frame);
  }
}

test("broadcasts each frame to every lane", () => {
  const hub = new AudioHub();
  const a = new SpyLane("en");
  const b = new SpyLane("es");
  hub.addLane(a);
  hub.addLane(b);

  hub.push(Buffer.alloc(640));
  assert.equal(a.received.length, 1);
  assert.equal(b.received.length, 1);
});

test("a throwing lane does not stop the others", (t) => {
  const errorMock = t.mock.method(console, "error", () => {});

  const hub = new AudioHub();
  const bad = new SpyLane("en", true);
  const good = new SpyLane("es");
  hub.addLane(bad);
  hub.addLane(good);

  hub.push(Buffer.alloc(640));
  assert.equal(good.received.length, 1);
  assert.equal(errorMock.mock.callCount(), 1);
  const call = errorMock.mock.calls[0];
  assert(call !== undefined);
  const [msg, err] = call.arguments;
  assert.equal(msg, "lane en threw on pushPcm");
  assert(err instanceof Error);
  assert.equal(err.message, "boom");
});

test("removeLane stops delivery", () => {
  const hub = new AudioHub();
  const a = new SpyLane("en");
  hub.addLane(a);
  hub.removeLane("en");
  hub.push(Buffer.alloc(640));
  assert.equal(a.received.length, 0);
  assert.equal(hub.laneCount, 0);
});

test("addLane throws instead of silently replacing an existing lane", () => {
  const hub = new AudioHub();
  const first = new SpyLane("en");
  const second = new SpyLane("en");
  hub.addLane(first);

  assert.throws(() => hub.addLane(second), /en/);
  assert.equal(hub.laneCount, 1);

  hub.push(Buffer.alloc(640));
  assert.equal(first.received.length, 1);
  assert.equal(second.received.length, 0);
});
