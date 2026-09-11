import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
  });
}

const config = {
  geminiApiKey: "unused",
  ingestToken: "t",
  port: 0,
  passthroughLane: false,
  offeredLanguages: ["ko", "en"] as const,
  maxConcurrentLanes: 6,
  laneGraceMs: 60000,
  transcriptHistoryLines: 200,
  transcriptDelayMs: 0,
  opusBitrate: 24000,
  streamPrimeMs: 0,
  webRoot: "",
  brand: {
    name: "",
    accent: "#3e8fd0",
    logoPath: "",
    theme: "dark" as const,
  },
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
  // Every lane is a translation now, so the fake session has to hear a whole
  // utterance (25 frames) before it produces any audio to encode.
  for (let i = 0; i < 30; i++) ingest.send(Buffer.alloc(640));

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

  const response = await rawRequest(port, `GET ${MALFORMED_TARGET} HTTP/1.1`, [
    "Connection: close",
  ]);
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

// A `webRoot` wires a fourth route onto a server that previously only ever
// answered "no route matched" for anything outside /config, /stream/* and
// the two WebSocket upgrades. These tests exist to catch the two ways that
// wiring can go wrong: the SPA fallback simply not working, and — the one
// the brief calls out explicitly — the fallback shadowing an API path that
// used to 404 and must keep 404ing once a webRoot is configured.
async function withWebRoot(
  run: (cfg: typeof config & { webRoot: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "tongyeok-web-root-"));
  try {
    await writeFile(join(root, "index.html"), "<!doctype html><title>attendee app</title>");
    await run({ ...config, webRoot: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("serves the built app at / once webRoot is configured", async () => {
  await withWebRoot(async (cfg) => {
    const server = createServer({
      config: cfg,
      clock: new SystemClock(),
      sessionFactory: createFakeTranslateSessionFactory(),
    });
    const port = await server.listen(0);

    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(await res.text(), /attendee app/);

    await server.close();
  });
});

test("a webRoot does not shadow /config, /stream/*, /listen, /admin or /ingest", async () => {
  await withWebRoot(async (cfg) => {
    const server = createServer({
      config: cfg,
      clock: new SystemClock(),
      sessionFactory: createFakeTranslateSessionFactory(),
    });
    const port = await server.listen(0);

    // /config must still answer as JSON, not fall through to the SPA.
    const cfgRes = await fetch(`http://127.0.0.1:${port}/config`);
    assert.equal(cfgRes.status, 200);
    assert.equal(cfgRes.headers.get("content-type"), "application/json");

    // Each of these is the exact extensionless shape the SPA fallback would
    // otherwise happily answer with index.html.
    for (const path of ["/listen", "/admin", "/ingest", "/stream/bogus"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, 404, `${path} must still 404, not serve the SPA`);
    }

    await server.close();
  });
});

test("without a webRoot, an unknown path still 404s exactly as before", async () => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);

  const res = await fetch(`http://127.0.0.1:${port}/some-deep-link`);
  assert.equal(res.status, 404);

  await server.close();
});

test("/config publishes the brand alongside the language list", async (t) => {
  const server = createServer({
    config: {
      ...config,
      brand: {
        name: "주일 예배",
        accent: "#7a3e9d",
        logoPath: "/srv/event/logo.svg",
        theme: "auto" as const,
      },
    },
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const body = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.deepEqual(body.brand, {
    name: "주일 예배",
    accent: "#7a3e9d",
    logoUrl: "/brand/logo",
    theme: "auto",
  });
});

// The client distinguishes "no logo" from "a logo that failed to load", and
// only the first should stop it ever making the request.
test("/config reports no logo url when none is configured", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const body = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.equal(body.brand.logoUrl, null);
  assert.equal(body.brand.name, null);
});

test("the configured logo is served at /brand/logo", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "brand-server-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logo = join(dir, "mark.svg");
  await writeFile(logo, "<svg xmlns='http://www.w3.org/2000/svg'/>");

  const server = createServer({
    config: { ...config, brand: { ...config.brand, logoPath: logo } },
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${port}/brand/logo`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/svg+xml");
  assert.match(await res.text(), /<svg/);
});

test("/brand/logo is a 404 when no logo is configured", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  assert.equal((await fetch(`http://127.0.0.1:${port}/brand/logo`)).status, 404);
});

// Same hazard as /config and /listen: with a webRoot configured, the SPA
// fallback would otherwise answer /brand/logo with index.html.
test("a webRoot does not shadow /brand/logo", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "brand-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.html"), "<!doctype html><title>spa</title>");

  const server = createServer({
    config: { ...config, webRoot: root },
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${port}/brand/logo`);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /spa/);
});

/**
 * Brand used to be frozen at boot, which meant every change to an event's
 * name or colour cost a server restart — and a restart mid-service drops
 * every phone in the room. It is mutable state now: the operator pushes a new
 * brand down the parent port and the next /config carries it.
 *
 * Pages already open keep the brand they loaded with until they refresh;
 * nothing here pushes to a connected phone.
 */
test("a brand pushed at runtime reaches /config without a restart", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const before = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.equal(before.brand.name, null);

  server.setBrand({
    name: "새문안 주일예배",
    accent: "#e8b64c",
    logoPath: "",
    theme: "light",
  });

  const after = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.deepEqual(after.brand, {
    name: "새문안 주일예배",
    accent: "#e8b64c",
    logoUrl: null,
    theme: "light",
  });
});

test("a logo pushed at runtime is served without a restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "brand-live-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logo = join(dir, "mark.svg");
  await writeFile(logo, "<svg xmlns='http://www.w3.org/2000/svg'/>");

  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  assert.equal((await fetch(`http://127.0.0.1:${port}/brand/logo`)).status, 404);

  server.setBrand({ ...config.brand, logoPath: logo });

  const res = await fetch(`http://127.0.0.1:${port}/brand/logo`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<svg/);
});

// The only way to measure a listener's real lag. `buffered.end` in the browser
// is the demuxer's read-ahead, not the live edge, so client-side readings
// cannot tell you how far behind the room someone is. Comparing this media
// clock against `audio.currentTime` can.
test("/stats reports each open lane's media clock", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const before = await (await fetch(`http://127.0.0.1:${port}/stats`)).json();
  assert.deepEqual(before.lanes, {}, "no lanes open until somebody listens");

  // Opening the stream opens the lane; the response is endless, so abort it.
  const ac = new AbortController();
  t.after(() => ac.abort());
  await fetch(`http://127.0.0.1:${port}/stream/ko.webm`, { signal: ac.signal });

  const after = await (await fetch(`http://127.0.0.1:${port}/stats`)).json();
  assert.equal(typeof after.lanes.ko.mediaMs, "number");
  assert.equal(typeof after.now, "number");
});

// If the event loop cannot keep pace with 50 ingest frames/s, PCM backs up in
// the socket until TCP backpressure and the operator's send cap fill, and the
// queue then SITS there — a constant delay that survives restarting capture and
// shows up nowhere in the UI. These two numbers are how you tell that apart
// from a streaming-side problem: framesReceived must climb at 50/s and the
// loop delay must stay in single-digit ms.
test("/stats reports ingest throughput and event loop health", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const body = await (await fetch(`http://127.0.0.1:${port}/stats`)).json();
  assert.equal(typeof body.ingest.framesReceived, "number");
  assert.equal(typeof body.ingest.framesDropped, "number");
  assert.equal(typeof body.eventLoopDelayP99Ms, "number");
});

// The attendee app's plain-<audio> fallback restarts its stream when playback
// falls further behind the lane clock than it expects, and "expects" has to
// mean the prime this server actually sends: a hardcoded 8 s was fine for a
// 3 s prime and became a restart every 5 s once a 24 kbps default derived a
// 16 s one. So the prime travels to the phone with the rest of /config.
test("/config publishes streamPrimeMs so the attendee app can size its drift threshold", async (t) => {
  const server = createServer({
    config: { ...config, streamPrimeMs: 3072 },
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const body = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.equal(body.streamPrimeMs, 3072);
});

/**
 * Whether the room has started.
 *
 * The ingest socket opens when the operator presses 시작 and closes when they
 * press 중지, so its connection state is exactly "is there a speaker to
 * listen to". The attendee app needs it for two reasons: telling an early
 * arrival that nothing has begun is kinder than handing them silence, and a
 * language row that cannot be tapped yet cannot open a Gemini session that
 * would bill for translating an empty room.
 */
test("/config reports the room as not live before the operator connects", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const body = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.equal(body.live, false);
});

test("/config reports the room as live once ingest is connected", async () => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);

  const ingest = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=t`);
  await new Promise((r) => ingest.once("open", r));

  const live = await (await fetch(`http://127.0.0.1:${port}/config`)).json();
  assert.equal(live.live, true);

  // Closed in order, and awaited: an ingest socket left open holds the event
  // loop and the whole test file hangs rather than failing.
  ingest.close();
  await new Promise((r) => ingest.once("close", r));
  await server.close();

  const after = await createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const afterPort = await after.listen(0);
  const body = await (await fetch(`http://127.0.0.1:${afterPort}/config`)).json();
  assert.equal(body.live, false, "a fresh server with no operator is not live");
  await after.close();
});

// The attendee app polls this while it waits, so it must never be answered
// from a cache that predates the operator pressing start.
test("/config is never cached", async (t) => {
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createFakeTranslateSessionFactory(),
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${port}/config`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});
