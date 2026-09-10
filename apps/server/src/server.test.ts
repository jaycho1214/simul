import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { WebSocket } from "ws";
import { SystemClock } from "./clock.ts";
import { createFakeTranslateSessionFactory } from "./gemini/fake-translate-session.ts";
import { createServer } from "./server.ts";

/**
 * Speaks HTTP down a raw socket, because `fetch` (and every other client
 * worth using) refuses to send a request target this malformed in the first
 * place. Node's own HTTP parser accepts targets that WHATWG `URL` rejects,
 * and that gap is only reachable from a client that does not validate — a
 * port scanner, a captive-portal probe, an MDM agent on venue wifi.
 * Resolves with everything the server sent back before the connection ended.
 */
function rawRequest(port: number, requestLine: string, headers: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write([requestLine, "Host: 127.0.0.1", ...headers, "", ""].join("\r\n"));
    });
    let received = "";
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("data", (chunk) => { received += chunk; });
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
  });
}

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

// `//[` is accepted by Node's HTTP parser and handed to the listener verbatim
// as `req.url`, but `new URL("//[", "http://localhost")` throws
// ERR_INVALID_URL. Thrown synchronously inside a request or upgrade listener
// with nothing to catch it, that is an uncaught exception: the process dies
// and every language lane dies with it, mid-talk, because one device on the
// venue's wifi probed a path.
const MALFORMED_TARGET = "//[";

test("a request target Node accepts but WHATWG URL rejects is answered, not fatal", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  // Registered up front: the failure mode under test is a *throw* out of the
  // request listener, which would otherwise skip the close() at the end and
  // leave this whole test file hanging on a still-listening server.
  t.after(() => server.close());

  const response = await rawRequest(port, `GET ${MALFORMED_TARGET} HTTP/1.1`, ["Connection: close"]);
  assert.match(response, /^HTTP\/1\.1 400 /, "the malformed request got a real HTTP answer");

  // The point of the assertion above is only worth anything if the server is
  // still standing afterwards: prove it still serves a normal request.
  const ok = await fetch(`http://127.0.0.1:${port}/config`);
  assert.equal(ok.status, 200);
  await ok.json();
});

test("a malformed upgrade target drops the socket instead of killing the process", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const response = await rawRequest(port, `GET ${MALFORMED_TARGET} HTTP/1.1`, [
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
  ]);
  assert.equal(response, "", "no handshake: the socket was destroyed outright");

  const listen = new WebSocket(`ws://127.0.0.1:${port}/listen?lang=en`);
  await new Promise((r) => listen.once("open", r));
  listen.close();
});
