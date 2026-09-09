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
      await new Promise<void>((resolve) => http.listen(port, resolve));
      const address = http.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close(): Promise<void> {
      adminSocket.stop();
      manager.closeAll();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
