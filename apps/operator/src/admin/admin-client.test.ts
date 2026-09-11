import { afterEach, describe, expect, test, vi } from "vitest";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { SocketLike } from "../net/reconnecting-socket.ts";
import { AdminClient, adminUrl } from "./admin-client.ts";

const openSockets: NodeWebSocket[] = [];
const factory = (url: string): SocketLike => {
  const ws = new NodeWebSocket(url);
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

const lanes = [
  {
    lang: "en",
    listeners: 2,
    audioListeners: 1,
    state: "live",
    laneDrops: 0,
    listenerDrops: 0,
    ageMs: 5,
  },
];

describe("adminUrl", () => {
  test("is the spec's localhost admin endpoint", () => {
    expect(adminUrl(8080)).toBe("ws://localhost:8080/admin");
  });
});

describe("AdminClient", () => {
  test("exposes the lane table the server pushed", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const { port } = wss.address() as AddressInfo;
    const usage = {
      since: 5,
      languages: [{ lang: "en", inputAudioTokens: 25, outputAudioTokens: 25 }],
    };
    wss.on("connection", (ws) => ws.send(JSON.stringify({ type: "lanes", lanes, usage })));

    const client = new AdminClient({
      url: `ws://127.0.0.1:${port}/admin`,
      factory,
      schedule: immediate,
    });
    client.start();

    await vi.waitFor(() => expect(client.lanes).toHaveLength(1));
    // audioListeners must survive the whole chain distinctly from listeners —
    // it is the only signal that shows an operator somebody muted.
    expect(client.lanes[0]).toMatchObject({ lang: "en", listeners: 2, audioListeners: 1 });
    expect(client.getSnapshot().externalListenerSeen).toBe(true);
    expect(client.getSnapshot().usage).toEqual(usage);

    client.stop();
    wss.close();
  });

  test("keeps the last good table when a malformed frame arrives", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const { port } = wss.address() as AddressInfo;
    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "lanes", lanes }));
      setTimeout(() => ws.send("}{ garbage"), 10);
    });

    const client = new AdminClient({
      url: `ws://127.0.0.1:${port}/admin`,
      factory,
      schedule: immediate,
    });
    client.start();

    await vi.waitFor(() => expect(client.lanes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 40));
    expect(client.lanes).toHaveLength(1);

    client.stop();
    wss.close();
  });

  test("externalListenerSeen latches — a phone that left still proves reachability", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.once("listening", r));
    const { port } = wss.address() as AddressInfo;
    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "lanes", lanes }));
      setTimeout(
        () => ws.send(JSON.stringify({ type: "lanes", lanes: [{ ...lanes[0], listeners: 0 }] })),
        10,
      );
    });

    const client = new AdminClient({
      url: `ws://127.0.0.1:${port}/admin`,
      factory,
      schedule: immediate,
    });
    client.start();

    await vi.waitFor(() => expect(client.getSnapshot().externalListenerSeen).toBe(true));
    await vi.waitFor(() => expect(client.lanes[0]?.listeners).toBe(0));
    expect(client.getSnapshot().externalListenerSeen).toBe(true);

    client.stop();
    wss.close();
  });
});
