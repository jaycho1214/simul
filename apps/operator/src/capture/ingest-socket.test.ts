import { afterEach, describe, expect, test, vi } from "vitest";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { SocketLike } from "../net/reconnecting-socket.ts";
import { IngestSocket, ingestUrl } from "./ingest-socket.ts";

const openSockets: NodeWebSocket[] = [];
const factory = (url: string): SocketLike => {
  const ws = new NodeWebSocket(url);
  ws.binaryType = "arraybuffer";
  openSockets.push(ws);
  return ws as unknown as SocketLike;
};
const immediate = (fn: () => void) => {
  const handle = setTimeout(fn, 0);
  return () => clearTimeout(handle);
};

afterEach(() => {
  for (const ws of openSockets.splice(0)) ws.close();
});

async function startServer() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", r));
  const { port } = wss.address() as AddressInfo;
  return { wss, port };
}

const frame = () => new Int16Array(320).fill(1234).buffer;

describe("ingestUrl", () => {
  test("is the spec's endpoint with the token in the query string", () => {
    expect(ingestUrl({ port: 8080, token: "abc" })).toBe("ws://localhost:8080/ingest?token=abc");
  });

  test("percent-encodes a token with URL-hostile characters", () => {
    expect(ingestUrl({ port: 8080, token: "a b&c" })).toBe(
      "ws://localhost:8080/ingest?token=a%20b%26c",
    );
  });
});

describe("IngestSocket", () => {
  test("delivers frames of exactly 640 bytes to a real server", async () => {
    const { wss, port } = await startServer();

    const sizes: number[] = [];
    wss.on("connection", (ws) => {
      ws.on("message", (data: Buffer) => sizes.push(data.byteLength));
    });

    const socket = new IngestSocket({
      url: `ws://127.0.0.1:${port}/ingest?token=t`,
      factory,
      schedule: immediate,
    });
    socket.start();
    await vi.waitFor(() => expect(socket.state).toBe("open"));

    for (let i = 0; i < 5; i++) expect(socket.sendFrame(frame())).toBe(true);
    await vi.waitFor(() => expect(sizes).toHaveLength(5));

    expect(sizes.every((n) => n === 640)).toBe(true);
    expect(socket.sentFrames).toBe(5);
    expect(socket.droppedFrames).toBe(0);

    socket.stop();
    wss.close();
  });

  test("drops and counts frames while the socket is down", () => {
    const socket = new IngestSocket({
      url: "ws://127.0.0.1:1/ingest?token=t",
      factory,
      schedule: immediate,
    });
    // Never started, so nothing is open.
    for (let i = 0; i < 3; i++) expect(socket.sendFrame(frame())).toBe(false);
    expect(socket.droppedFrames).toBe(3);
    expect(socket.sentFrames).toBe(0);
  });

  test("drops frames once the send buffer passes the cap", async () => {
    // A stalled server is simulated by a socket that accepts sends but never
    // drains; only bufferedAmount is stubbed, the drop policy under test is real.
    const stalled: SocketLike = {
      binaryType: "arraybuffer",
      bufferedAmount: 512 * 1024,
      readyState: 1,
      send: () => {
        throw new Error("must not be called while over the cap");
      },
      close: () => {},
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === "open") queueMicrotask(() => fn({}));
      },
      removeEventListener: () => {},
    };

    const socket = new IngestSocket({
      url: "ws://ignored",
      factory: () => stalled,
      schedule: immediate,
      maxBufferedBytes: 256 * 1024,
    });
    socket.start();
    await vi.waitFor(() => expect(socket.state).toBe("open"));

    expect(socket.sendFrame(frame())).toBe(false);
    expect(socket.droppedFrames).toBe(1);
  });

  test("rejects a frame that is not exactly 640 bytes", () => {
    const socket = new IngestSocket({
      url: "ws://ignored",
      factory,
      schedule: immediate,
    });
    expect(() => socket.sendFrame(new ArrayBuffer(320))).toThrow(/640/);
  });

  describe("close-code handling, matching apps/server/src/http/ingest-gateway.ts exactly", () => {
    test("a bad token (4401) is terminal: it stops instead of retrying with the same token", async () => {
      const { wss, port } = await startServer();
      wss.on("connection", (ws) => ws.close(4401, "unauthorized"));

      const socket = new IngestSocket({
        url: `ws://127.0.0.1:${port}/ingest?token=wrong`,
        factory,
        schedule: immediate,
      });
      socket.start();

      await vi.waitFor(() => expect(socket.state).toBe("stopped"));
      expect(socket.closeReason).toBe("unauthorized");

      // No further reconnect attempts against a token that can never succeed.
      await new Promise((r) => setTimeout(r, 30));
      expect(socket.state).toBe("stopped");

      socket.stop();
      wss.close();
    });

    test("being superseded (4409) stops instead of fighting the instance that took over", async () => {
      const { wss, port } = await startServer();
      wss.on("connection", (ws) => ws.close(4409, "superseded by a newer ingest connection"));

      const socket = new IngestSocket({
        url: `ws://127.0.0.1:${port}/ingest?token=t`,
        factory,
        schedule: immediate,
      });
      socket.start();

      await vi.waitFor(() => expect(socket.state).toBe("stopped"));
      expect(socket.closeReason).toBe("superseded");

      socket.stop();
      wss.close();
    });

    test("an ordinary close reconnects with backoff and carries no close reason", async () => {
      const { wss, port } = await startServer();
      let connections = 0;
      wss.on("connection", (ws) => {
        connections++;
        if (connections === 1) ws.close(1011, "internal error");
      });

      const socket = new IngestSocket({
        url: `ws://127.0.0.1:${port}/ingest?token=t`,
        factory,
        schedule: immediate,
      });
      socket.start();

      await vi.waitFor(() => expect(socket.state).toBe("open"));
      expect(connections).toBeGreaterThanOrEqual(2);
      expect(socket.closeReason).toBeUndefined();

      socket.stop();
      wss.close();
    });

    test("start() clears a previous close reason so a fresh attempt is not still labelled stale", async () => {
      const { wss, port } = await startServer();
      wss.on("connection", (ws) => ws.close(4401, "unauthorized"));

      const socket = new IngestSocket({
        url: `ws://127.0.0.1:${port}/ingest?token=wrong`,
        factory,
        schedule: immediate,
      });
      socket.start();
      await vi.waitFor(() => expect(socket.closeReason).toBe("unauthorized"));

      socket.start();
      expect(socket.closeReason).toBeUndefined();

      socket.stop();
      wss.close();
    });
  });
});
