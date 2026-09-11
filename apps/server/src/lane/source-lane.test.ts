import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { CLUSTER_ID } from "../audio/webm-sink.ts";
import { SourceLane } from "./source-lane.ts";

test("a cold lane primes its backlog so the very first listener does not wait", () => {
  // Nobody has spoken and no PCM has been pushed: exactly the state the first
  // attendee to tap a language finds the lane in.
  const lane = new SourceLane("ko", 24000, new FakeClock(), 400);
  assert.ok(
    lane.backlog.includes(CLUSTER_ID),
    "a cold lane must still hand over enough timestamped audio to start playback",
  );
  lane.close();
});

test("priming does not lose the first real audio pushed after it", () => {
  const lane = new SourceLane("ko", 24000, new FakeClock(), 400);
  const clusters: Buffer[] = [];
  lane.subscribeClusters((c) => clusters.push(c));
  for (let i = 0; i < 10; i++) lane.pushPcm(Buffer.alloc(640));
  assert.ok(clusters.length > 0, "real audio still reaches live subscribers");
  lane.close();
});

test("reports its media clock, so client lag can be measured against it", () => {
  const lane = new SourceLane("ko", 24000, new FakeClock(), 0);
  assert.equal(lane.mediaMs, 0);
  for (let i = 0; i < 50; i++) lane.pushPcm(Buffer.alloc(640)); // 50 x 20ms = 1s
  assert.equal(lane.mediaMs, 1000);
  lane.close();
});

test("the media clock includes the prime, matching the timestamps clients receive", () => {
  const lane = new SourceLane("ko", 24000, new FakeClock(), 400);
  assert.equal(lane.mediaMs, 400, "a primed lane's timeline starts after the prime");
  lane.close();
});
