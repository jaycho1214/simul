import { afterEach, describe, expect, test, vi } from "vitest";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { ReconnectingSocket, backoffMs, type SocketLike } from "./reconnecting-socket.ts";

/** A real ws server on an ephemeral port. */
async function startServer() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as AddressInfo;
  return { wss, url: `ws://127.0.0.1:${port}` };
}

const openSockets: NodeWebSocket[] = [];
const factory = (url: string): SocketLike => {
  const ws = new NodeWebSocket(url);
  ws.binaryType = "arraybuffer";
  openSockets.push(ws);
  return ws as unknown as SocketLike;
};

/** Retries fire immediately, so no test waits on a real backoff. */
const immediate = (fn: () => void) => {
  const handle = setTimeout(fn, 0);
  return () => clearTimeout(handle);
};

afterEach(() => {
  for (const ws of openSockets.splice(0)) ws.close();
});

describe("backoffMs", () => {
  test("grows and then caps", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([
      250, 500, 1000, 2000, 4000, 8000, 8000,
    ]);
  });
});

describe("ReconnectingSocket", () => {
  test("reaches open against a real server", async () => {
    const { wss, url } = await startServer();
    const states: string[] = [];
    const socket = new ReconnectingSocket({ url, factory, schedule: immediate });
    socket.onState((s) => states.push(s));
    socket.start();

    await vi.waitFor(() => expect(socket.state).toBe("open"));
    expect(states).toEqual(["connecting", "open"]);

    socket.stop();
    wss.close();
  });

  test("reconnects after the server drops the connection", async () => {
    const { wss, url } = await startServer();
    let connections = 0;
    wss.on("connection", (ws) => {
      connections++;
      if (connections === 1) ws.close();
    });

    const socket = new ReconnectingSocket({ url, factory, schedule: immediate });
    socket.start();

    await vi.waitFor(() => expect(connections).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(socket.state).toBe("open"));

    socket.stop();
    wss.close();
  });

  test("stop() is final — no further reconnect attempts", async () => {
    const { wss, url } = await startServer();
    const socket = new ReconnectingSocket({ url, factory, schedule: immediate });
    socket.start();
    await vi.waitFor(() => expect(socket.state).toBe("open"));

    socket.stop();
    expect(socket.state).toBe("stopped");

    const before = socket.attempts;
    await new Promise((r) => setTimeout(r, 50));
    expect(socket.attempts).toBe(before);

    wss.close();
  });

  test("delivers server messages to onMessage subscribers", async () => {
    const { wss, url } = await startServer();
    wss.on("connection", (ws) => ws.send("hello"));

    const received: string[] = [];
    const socket = new ReconnectingSocket({ url, factory, schedule: immediate });
    socket.onMessage((data) => received.push(String(data)));
    socket.start();

    await vi.waitFor(() => expect(received).toEqual(["hello"]));

    socket.stop();
    wss.close();
  });

  test("a refused connection retries rather than throwing", async () => {
    // Port 1 is reserved and nothing listens on it.
    const states: string[] = [];
    const socket = new ReconnectingSocket({
      url: "ws://127.0.0.1:1",
      factory,
      schedule: immediate,
    });
    socket.onState((s) => states.push(s));
    socket.start();

    await vi.waitFor(() => expect(socket.attempts).toBeGreaterThanOrEqual(2));
    // The instantaneous state is either "connecting" or "reconnecting" depending
    // on where in the retry loop the poll landed, so assert on the history: it
    // reached "reconnecting" at least once and never reached "open".
    expect(states).toContain("reconnecting");
    expect(states).not.toContain("open");

    socket.stop();
  });

  test("shouldReconnect(false) ends the retry loop instead of fighting a close it was told to accept", async () => {
    // Mirrors the ingest gateway's 4409 "superseded" close: a caller with
    // protocol-specific knowledge can call off retries entirely, distinct from
    // the default of always retrying an ordinary drop.
    const { wss, url } = await startServer();
    wss.on("connection", (ws) => ws.close(4409, "superseded"));

    const seen: Array<{ code: number; reason: string }> = [];
    const socket = new ReconnectingSocket({
      url,
      factory,
      schedule: immediate,
      shouldReconnect: (info) => {
        seen.push(info);
        return info.code !== 4409;
      },
    });
    socket.start();

    await vi.waitFor(() => expect(socket.state).toBe("stopped"));
    expect(seen).toEqual([{ code: 4409, reason: "superseded" }]);

    // No further reconnect attempts fire even after waiting past the backoff.
    // (attempts resets to 0 on the open that preceded this close — a
    // connection that briefly succeeded before being closed still counts as
    // a reset, per "backoff resets on success" — so what's asserted here is
    // that it does not change again, not a specific count.)
    const before = socket.attempts;
    await new Promise((r) => setTimeout(r, 30));
    expect(socket.attempts).toBe(before);

    wss.close();
  });

  test("shouldReconnect defaults to always retrying when not provided", async () => {
    const { wss, url } = await startServer();
    let connections = 0;
    wss.on("connection", (ws) => {
      connections++;
      if (connections === 1) ws.close(4999, "an ordinary, uninteresting close code");
    });

    const socket = new ReconnectingSocket({ url, factory, schedule: immediate });
    socket.start();

    await vi.waitFor(() => expect(socket.state).toBe("open"));
    expect(connections).toBeGreaterThanOrEqual(2);

    socket.stop();
    wss.close();
  });
});
