import { createServer as createHttpServer, type Server } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { WebSocketServer } from "ws";
import type { Brand, Config } from "./config.ts";
import type { Clock } from "./clock.ts";
import { AudioHub } from "./audio-hub.ts";
import { LaneManager, PASSTHROUGH_LANG, type Offered } from "./lane/lane-manager.ts";
import { IngestGateway } from "./http/ingest-gateway.ts";
import { BrandRoute } from "./http/brand-route.ts";
import { StreamRoute } from "./http/stream-route.ts";
import { ListenSocket } from "./http/listen-socket.ts";
import { AdminSocket } from "./http/admin-socket.ts";
import { StaticRoute } from "./http/static-route.ts";
import type { TranslateSessionFactory } from "./gemini/translate-session.ts";

/**
 * Node's HTTP parser is deliberately more permissive than WHATWG `URL`: it
 * accepts request targets like `//[` and hands them to the listener verbatim
 * as `req.url`, where `new URL(target, base)` throws `ERR_INVALID_URL`.
 * Thrown synchronously inside a request or upgrade listener there is nothing
 * to catch it, so it surfaces as an uncaught exception and takes the whole
 * process — every language lane, mid-talk — down with it. Nobody has to be
 * attacking the server for this to happen: a port scanner, a captive-portal
 * probe or an MDM agent on the venue's wifi does it by accident. Returns
 * `undefined` instead of throwing so each listener can answer the request on
 * its own terms.
 */
function parseRequestTarget(target: string | undefined): URL | undefined {
  try {
    return new URL(target ?? "/", "http://localhost");
  } catch {
    return undefined;
  }
}

/**
 * `/listen`, `/admin` and `/ingest` only ever answer as WebSocket upgrades —
 * the plain-HTTP request handler below has never had a case for them and
 * they fall through to its 404, same as any other unknown path. `/stream/*`
 * is handled above by regex for the well-formed `<lang>.webm` shape, but a
 * malformed variant (no extension, wrong extension, extra segments) falls
 * through the same way. Adding the SPA's "serve index.html for anything
 * without a file extension" fallback below must not change any of that: an
 * extensionless path is exactly the shape of `/listen` and `/admin`, so
 * without this guard the static route would happily hand back `index.html`
 * for them once a `webRoot` is configured, silently replacing a 404 with a
 * 200 for what looks like a protocol endpoint.
 */
function isReservedApiPath(pathname: string): boolean {
  return (
    pathname === "/config" ||
    pathname === "/stats" ||
    pathname === "/brand/logo" ||
    pathname === "/listen" ||
    pathname === "/admin" ||
    pathname === "/ingest" ||
    pathname.startsWith("/stream/")
  );
}

export interface ServerDeps {
  config: Config;
  clock: Clock;
  sessionFactory: TranslateSessionFactory;
}

/**
 * Wires every piece built by tasks 1-15 behind one HTTP server: ingest
 * WebSocket -> AudioHub -> per-language lane -> Opus -> WebMSink -> chunked
 * HTTP response, plus the listen and admin WebSockets. Exported separately
 * from `index.ts` so the Electron operator app can load it directly into a
 * `utilityProcess` instead of spawning a child process.
 */
export function createServer(deps: ServerDeps) {
  const { config, clock, sessionFactory } = deps;

  /**
   * Ingest arrives at a fixed 50 frames/s and every frame is encoded for the
   * source lane plus, per translated lane, base64-encoded and pushed at Gemini.
   * If that work ever outpaces the loop, PCM queues in the socket rather than
   * failing loudly: TCP backpressure fills, then the operator's 128 KB send cap
   * fills, and audio simply arrives seconds late for the rest of the event
   * while every lane still reports healthy. This is cheap (a histogram updated
   * by libuv, not per-request work) and it is the only thing that tells that
   * apart from latency in the streaming path.
   */
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const hub = new AudioHub();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory,
    passthroughLane: config.passthroughLane,
    offeredLanguages: config.offeredLanguages,
    maxConcurrentLanes: config.maxConcurrentLanes,
    laneGraceMs: config.laneGraceMs,
    transcriptHistoryLines: config.transcriptHistoryLines,
    opusBitrate: config.opusBitrate,
    streamPrimeMs: config.streamPrimeMs,
  });

  const ingest = new IngestGateway({ hub, token: config.ingestToken });
  const streamRoute = new StreamRoute({ manager });

  /**
   * The one piece of config that is not frozen at boot. Everything else here
   * shapes how audio is captured and encoded and cannot change under a
   * running lane, but the brand is only ever read when a phone asks for
   * /config or /brand/logo — so it can be replaced live, and an operator
   * fixing a misspelled event name does not have to drop every phone in the
   * room to do it. Pushed in over the parent port; see server-entry.ts.
   */
  let brand: Brand = config.brand;
  let brandRoute = new BrandRoute(brand.logoPath);
  const listenSocket = new ListenSocket({ manager });
  const adminSocket = new AdminSocket({ manager, streamRoute, clock });
  const staticRoute = config.webRoot ? new StaticRoute({ root: config.webRoot }) : null;

  const http: Server = createHttpServer((req, res) => {
    const url = parseRequestTarget(req.url);
    if (!url) {
      // The request line itself is unusable, so there is no route to
      // dispatch on and nothing to say beyond "that was not a request I can
      // read". 400 and done.
      res.writeHead(400).end();
      return;
    }

    // The capture group is restricted to letters and hyphens only, so it
    // can never smuggle a path separator, a query string, or anything else
    // that would let `/stream/<lang>.webm` be spoofed into targeting some
    // other route or an unexpected language value; anything outside that
    // charset simply fails to match and falls through to 404.
    const stream = /^\/stream\/([a-zA-Z-]+)\.webm$/.exec(url.pathname);
    if (stream) {
      void streamRoute.handle(res, stream[1]!);
      return;
    }

    if (url.pathname === "/config") {
      // Only these fields: never GEMINI_API_KEY or INGEST_TOKEN.
      //
      // Polled by the attendee app while it waits for the room to start, so
      // it must never be answered from a cache that predates the operator
      // pressing 시작.
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          // From the manager, not `config`: the list can grow while the
          // server runs (see `offer` below).
          offeredLanguages: manager.offered().languages,
          // The ingest socket opens on 시작 and closes on 중지, so its state is
          // exactly "is there a speaker to listen to". The attendee app uses it
          // to keep an early arrival from tapping a language — which would open
          // a Gemini session, and bill for translating an empty room.
          live: ingest.connected,
          // The debug passthrough lane's code, or null when it is not offered.
          passthroughLanguage: manager.offered().passthroughLane ? PASSTHROUGH_LANG : null,
          transcriptDelayMs: config.transcriptDelayMs,
          // How far behind live a plain-<audio> listener starts (see StreamRoute
          // and WebMSink.backlog). The phone sizes its drift threshold from it.
          streamPrimeMs: config.streamPrimeMs,
          // Null rather than "" for the two optional fields: the client tells
          // "unset" from "set to something empty", and only the former should
          // stop it laying out a slot for them at all.
          brand: {
            name: brand.name || null,
            accent: brand.accent,
            logoUrl: brand.logoPath ? "/brand/logo" : null,
            theme: brand.theme,
          },
        }),
      );
      return;
    }

    // Diagnostic. A listener's TRUE lag is `mediaMs / 1000 - audio.currentTime`
    // — nothing measurable in the browser gives it, because `buffered.end` is
    // only the demuxer's read-ahead and can itself trail the source badly.
    // This matters because lag is not fixed: at 1.0x playback every stall adds
    // its own duration permanently, so a stream that starves occasionally
    // drifts further behind the room all event and never recovers.
    if (url.pathname === "/stats") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          now: Date.now(),
          // Nanoseconds from the histogram; ms is what a human reads.
          eventLoopDelayP99Ms: Number((loopDelay.percentile(99) / 1e6).toFixed(2)),
          ingest: {
            framesReceived: ingest.framesReceived,
            framesDropped: ingest.framesDropped,
          },
          lanes: Object.fromEntries(
            manager.statuses().map((status) => [
              status.lang,
              {
                mediaMs: manager.get(status.lang)?.mediaMs ?? null,
                state: status.state,
                listeners: status.listeners,
                laneDrops: status.laneDrops,
                listenerDrops: streamRoute.listenerDrops(status.lang),
              },
            ]),
          ),
        }),
      );
      return;
    }

    if (url.pathname === "/brand/logo") {
      void brandRoute.handle(res).then((served) => {
        if (!served) res.writeHead(404).end();
      });
      return;
    }

    if (staticRoute && !isReservedApiPath(url.pathname)) {
      void staticRoute.handle(req, res, url.pathname).then((served) => {
        if (!served) res.writeHead(404).end();
      });
      return;
    }

    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const url = parseRequestTarget(req.url);
    if (!url) {
      // An upgrade has no response object to write a status onto — the only
      // thing left is to drop the connection rather than complete a
      // handshake for an endpoint that could not be identified.
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (url.pathname === "/ingest") {
        ingest.handleConnection(ws, url);
      } else if (url.pathname === "/listen") {
        void listenSocket.handleConnection(ws, url.searchParams.get("lang") ?? "");
      } else if (url.pathname === "/admin") {
        adminSocket.handleConnection(ws);
      } else {
        ws.close(4404, "unknown endpoint");
      }
    });
  });

  return {
    /**
     * Replaces the brand for every subsequent /config and /brand/logo. Takes
     * effect on the next page load; phones already listening keep what they
     * loaded with.
     */
    setBrand(next: Brand): void {
      brand = next;
      brandRoute = new BrandRoute(next.logoPath);
    },

    /**
     * Widens the language list for every subsequent acquire and /config.
     * Add-only, by design: see `LaneManager.offer`. The phones on the picker
     * see a new row on their next poll; a removal waits for a restart.
     */
    offer(next: { languages: readonly string[]; passthroughLane: boolean }): void {
      manager.offer(next);
    },

    /** What the running server actually serves, for the operator's panel. */
    offered(): Offered {
      return manager.offered();
    },

    async listen(port: number): Promise<number> {
      // `http.listen()`'s callback only ever fires on success; a bind
      // failure (EADDRINUSE from a stale port on a quick restart, or two
      // instances racing for the same port) is reported solely via the
      // "error" event. With no listener attached, Node's EventEmitter
      // throws that error as an uncaught exception instead of rejecting
      // this promise, which kills the whole process with a raw stack
      // trace before anything gets a chance to report it — worse than a
      // clean rejection in the Electron `utilityProcess` embedding, where
      // nothing else is watching stderr. Race the two events explicitly
      // and remove whichever listener didn't fire so neither leaks past
      // this call.
      await new Promise<void>((resolve, reject) => {
        function onError(err: Error): void {
          http.removeListener("listening", onListening);
          reject(err);
        }
        function onListening(): void {
          http.removeListener("error", onError);
          resolve();
        }
        http.once("error", onError);
        http.listen(port, onListening);
      });
      const address = http.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close(): Promise<void> {
      loopDelay.disable();
      adminSocket.stop();
      manager.closeAll();

      // Best-effort courtesy: give every connected WebSocket (ingest,
      // listen, admin) a real close frame before anything is forced off
      // the wire, so a well-behaved client sees a clean shutdown rather
      // than a severed connection. Not awaited — a client that never acks
      // it must not be able to reintroduce the hang this whole method
      // exists to avoid.
      for (const client of wss.clients) {
        client.close(1001, "server shutting down");
      }
      wss.close();

      // `http.close()`'s callback does not fire until every socket ends —
      // including upgraded WebSockets and long-lived chunked `/stream`
      // responses, which is the server's normal, expected state while an
      // event is running. Without forcing them closed, an attendee's phone
      // left open on a stream, or an operator's dashboard, hangs this
      // forever: `index.ts`'s `close().then(() => process.exit(0))` never
      // runs, and the process needs a hard kill. `closeAllConnections()`
      // (Node >=18.2, guaranteed by this package's engines floor) forces
      // every remaining connection closed immediately after `close()` has
      // stopped accepting new ones, so this always resolves in bounded
      // time regardless of who is still connected.
      const closed = new Promise<void>((resolve) => http.close(() => resolve()));
      http.closeAllConnections();
      await closed;
    },
  };
}
