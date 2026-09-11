import { test } from "node:test";
import assert from "node:assert/strict";
import { WebMSink, CLUSTER_ID } from "./webm-sink.ts";

const frame = () => Buffer.from([0xfc, 0xff, 0xfe]); // any non-empty Opus payload

test("init segment starts with the EBML magic and declares webm", () => {
  const sink = new WebMSink({ inputSampleRate: 24000 });
  const init = sink.initSegment;
  assert.deepEqual([...init.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(init.includes(Buffer.from("webm")));
  assert.ok(init.includes(Buffer.from("A_OPUS")));
  assert.ok(init.includes(Buffer.from("OpusHead")));
});

test("init segment contains no cluster", () => {
  const sink = new WebMSink({ inputSampleRate: 24000 });
  assert.equal(sink.initSegment.indexOf(CLUSTER_ID), -1);
});

test("emits a cluster once clusterMs of frames have accumulated", () => {
  const sink = new WebMSink({ inputSampleRate: 24000, clusterMs: 100 });
  const clusters: Buffer[] = [];
  sink.subscribe((c) => clusters.push(c));

  for (let i = 0; i < 4; i++) sink.writeOpus(frame());
  assert.equal(clusters.length, 0, "4 frames is only 80 ms");

  sink.writeOpus(frame());
  assert.equal(clusters.length, 1, "the 5th frame completes 100 ms");
  assert.deepEqual([...clusters[0]!.subarray(0, 4)], [...CLUSTER_ID]);
});

test("cluster timestamps advance by clusterMs", () => {
  const sink = new WebMSink({ inputSampleRate: 24000, clusterMs: 100 });
  const clusters: Buffer[] = [];
  sink.subscribe((c) => clusters.push(c));
  for (let i = 0; i < 10; i++) sink.writeOpus(frame());

  assert.equal(clusters.length, 2);
  // Cluster id (4) + size vint, then Timestamp element 0xE7.
  assert.ok(clusters[1]!.includes(Buffer.from([0xe7])));
  assert.notDeepEqual(clusters[0], clusters[1]);
});

test("rejects a clusterMs that would overflow the SimpleBlock's signed 16-bit timestamp", () => {
  assert.throws(
    () => new WebMSink({ inputSampleRate: 24000, clusterMs: 32768 }),
    /clusterMs/,
  );
});

test("unsubscribe stops cluster delivery", () => {
  const sink = new WebMSink({ inputSampleRate: 24000, clusterMs: 20 });
  let count = 0;
  const off = sink.subscribe(() => { count++; });
  sink.writeOpus(frame());
  off();
  sink.writeOpus(frame());
  assert.equal(count, 1);
  assert.equal(sink.subscriberCount, 0);
});

test("backlog holds only the most recent backlogMs of clusters", () => {
  const sink = new WebMSink({ inputSampleRate: 24000, clusterMs: 100, backlogMs: 300 });
  const clusters: Buffer[] = [];
  sink.subscribe((c) => clusters.push(c));

  // 25 frames = 5 clusters of 100 ms; only the last 3 fit in 300 ms.
  for (let i = 0; i < 25; i++) sink.writeOpus(frame());
  assert.equal(clusters.length, 5);

  assert.deepEqual(sink.backlog, Buffer.concat(clusters.slice(-3)));
});
