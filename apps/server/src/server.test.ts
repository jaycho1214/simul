import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { SystemClock } from "./clock.ts";
import { createFakeTranslateSessionFactory } from "./gemini/fake-translate-session.ts";
import { createServer } from "./server.ts";

const config = {
  geminiApiKey: "unused",
  ingestToken: "t",
  port: 0,
  sourceLanguage: "ko",
  offeredLanguages: ["ko", "en"] as const,
  maxConcurrentLanes: 6,
  laneGraceMs: 60000,
  transcriptHistoryLines: 200,
  transcriptDelayMs: 0,
  opusBitrate: 24000,
};

test("audio flows from ingest to a streaming client", async () => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);

  const res = await fetch(`http://127.0.0.1:${port}/stream/ko.webm`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/webm");

  const reader = res.body!.getReader();
  const init = await reader.read();
  assert.ok(Buffer.from(init.value!).includes(Buffer.from("OpusHead")));

  const ingest = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=t`);
  await new Promise((r) => ingest.once("open", r));
  for (let i = 0; i < 20; i++) ingest.send(Buffer.alloc(640));

  const cluster = await reader.read();
  assert.ok(cluster.value!.length > 0, "a cluster reached the client");

  await reader.cancel();
  ingest.close();
  await server.close();
});

test("transcripts arrive on the listen socket", async () => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);

  const listen = new WebSocket(`ws://127.0.0.1:${port}/listen?lang=en`);
  const messages: any[] = [];
  listen.on("message", (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((r) => listen.once("open", r));

  const ingest = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=t`);
  await new Promise((r) => ingest.once("open", r));
  for (let i = 0; i < 30; i++) ingest.send(Buffer.alloc(640));

  await new Promise((r) => setTimeout(r, 200));
  assert.ok(messages.some((m) => m.type === "transcript"));

  listen.close();
  ingest.close();
  await server.close();
});

test("close() resolves promptly even with a client still connected", async () => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);

  // Neither of these is ever closed from the client side below — a live
  // chunked stream response and a live upgraded WebSocket are exactly the
  // shape of connection that used to make close() hang forever, since
  // http.close()'s callback does not fire until every socket ends.
  const res = await fetch(`http://127.0.0.1:${port}/stream/ko.webm`);
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  await reader.read(); // consume the init segment so the connection is fully live

  const listen = new WebSocket(`ws://127.0.0.1:${port}/listen?lang=en`);
  listen.on("error", () => {}); // the server forcibly drops this socket below
  await new Promise((r) => listen.once("open", r));

  const timedOut = Symbol("timed out");
  const timeout = new Promise((resolve) => setTimeout(() => resolve(timedOut), 2000));

  const result = await Promise.race([server.close().then(() => "closed"), timeout]);
  assert.notEqual(result, timedOut, "server.close() did not resolve within 2s");

  await reader.cancel().catch(() => {});
});

test("listen() rejects instead of crashing when the port is already in use", async () => {
  const serverA = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await serverA.listen(0);

  const serverB = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });

  await assert.rejects(() => serverB.listen(port));

  await serverA.close();
});
