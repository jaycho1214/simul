import { createServer as createHttpServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import type { Config } from "./config.ts";
import type { Clock } from "./clock.ts";
import { AudioHub } from "./audio-hub.ts";
import { LaneManager } from "./lane/lane-manager.ts";
import { IngestGateway } from "./http/ingest-gateway.ts";
import { StreamRoute } from "./http/stream-route.ts";
import { ListenSocket } from "./http/listen-socket.ts";
import { AdminSocket } from "./http/admin-socket.ts";
import type { TranslateSessionFactory } from "./gemini/translate-session.ts";

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

  const hub = new AudioHub();
  const manager = new LaneManager({
    clock,
    hub,
    sessionFactory,
    sourceLanguage: config.sourceLanguage,
    offeredLanguages: config.offeredLanguages,
    maxConcurrentLanes: config.maxConcurrentLanes,
    laneGraceMs: config.laneGraceMs,
    transcriptHistoryLines: config.transcriptHistoryLines,
    opusBitrate: config.opusBitrate,
  });

  const ingest = new IngestGateway({ hub, token: config.ingestToken });
  const streamRoute = new StreamRoute({ manager });
  const listenSocket = new ListenSocket({ manager });
  const adminSocket = new AdminSocket({ manager, streamRoute, clock });

  const http: Server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

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
      // Only these three fields: never GEMINI_API_KEY or INGEST_TOKEN.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        offeredLanguages: config.offeredLanguages,
        sourceLanguage: config.sourceLanguage,
        transcriptDelayMs: config.transcriptDelayMs,
      }));
      return;
    }

    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");

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
