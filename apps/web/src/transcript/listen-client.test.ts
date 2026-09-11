import type { ServerMessage } from "@simul/protocol";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ListenClient,
  parseServerMessage,
  type ConnectionStatus,
  type WebSocketLike,
} from "./listen-client.ts";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];

  readyState = 0;
  closeCalls = 0;
  /** ListenClient has no way to reach this — the test asserts it stays empty. */
  readonly sent: unknown[] = [];

  private readonly handlers = new Map<string, Set<(event: Event) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }

  close(): void {
    this.closeCalls++;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatch("close", new Event("close"));
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open", new Event("open"));
  }

  deliver(message: unknown): void {
    this.deliverRaw(JSON.stringify(message));
  }

  deliverRaw(data: string): void {
    const event = new Event("message") as Event & { data?: string };
    event.data = data;
    this.dispatch("message", event);
  }

  dropFromServer(): void {
    this.readyState = 3;
    this.dispatch("close", new Event("close"));
  }

  private dispatch(type: string, event: Event): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(event);
  }
}

function setup(overrides: Partial<{ staleAfterHiddenMs: number }> = {}) {
  FakeSocket.instances = [];
  const messages: ServerMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  let clock = 0;

  const client = new ListenClient({
    lang: "es",
    wsBaseUrl: "ws://192.168.1.4:8080",
    createSocket: (url) => new FakeSocket(url),
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
    reconnectDelaysMs: [500, 1000, 2000],
    now: () => clock,
    staleAfterHiddenMs: overrides.staleAfterHiddenMs ?? 10_000,
  });

  return {
    client,
    messages,
    statuses,
    advanceClock: (ms: number) => {
      clock += ms;
    },
    last: () => FakeSocket.instances.at(-1)!,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("parseServerMessage", () => {
  test("accepts every server message type", () => {
    const messages: ServerMessage[] = [
      { type: "hello", lang: "es", historyLines: 3 },
      { type: "history", lines: [] },
      { type: "transcript", line: { seq: 1, text: "hola", isFinal: true, ts: 5 } },
      { type: "lane", state: "live" },
      { type: "error", code: "lane_cap", message: "x" },
    ];
    for (const message of messages) {
      expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    }
  });

  test("rejects malformed, non-string and unknown payloads", () => {
    expect(parseServerMessage("{not json")).toBeNull();
    expect(parseServerMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseServerMessage(JSON.stringify(null))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "invented" }))).toBeNull();
  });
});

describe("ListenClient", () => {
  test("connects to /listen with the language query", () => {
    const { client, last } = setup();
    client.start();

    expect(last().url).toBe("ws://192.168.1.4:8080/listen?lang=es");
  });

  test("forwards parsed messages and ignores malformed ones", () => {
    const { client, messages, last } = setup();
    client.start();
    last().open();

    last().deliver({ type: "lane", state: "live" });
    last().deliverRaw("{not json");
    last().deliver({ type: "not-a-real-type" });

    expect(messages).toEqual([{ type: "lane", state: "live" }]);
  });

  test("reconnects with backoff after an unexpected close", () => {
    vi.useFakeTimers();
    const { client, last } = setup();
    client.start();
    last().open();

    last().dropFromServer();
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // Second failure waits longer.
    last().dropFromServer();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  test("does not reconnect after stop", () => {
    vi.useFakeTimers();
    const { client } = setup();
    client.start();

    client.stop();
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.status).toBe("closed");
  });

  test("a server error message stops auto-reconnect", () => {
    vi.useFakeTimers();
    const { client, messages, last } = setup();
    client.start();
    last().open();

    last().deliver({
      type: "error",
      code: "unknown_language",
      message: "알 수 없는 언어입니다 / Unknown language",
    });
    last().dropFromServer();
    vi.advanceTimersByTime(60_000);

    expect(messages.at(-1)!.type).toBe("error");
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.status).toBe("fatal");
  });

  test("returning to the foreground after a long hide forces a reconnect", () => {
    const { client, advanceClock, last } = setup();
    client.start();
    last().open();

    client.onHidden();
    advanceClock(120_000);
    // The socket still claims to be OPEN — a suspended one usually does — so a
    // readyState check alone would leave the reader staring at a dead feed.
    expect(last().readyState).toBe(1);
    client.onVisible();

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[0]!.closeCalls).toBe(1);
  });

  test("returning to the foreground quickly leaves a healthy socket alone", () => {
    const { client, advanceClock, last } = setup();
    client.start();
    last().open();

    client.onHidden();
    advanceClock(1_000);
    client.onVisible();

    expect(FakeSocket.instances).toHaveLength(1);
  });

  test("never sends anything to the server", () => {
    const { client, advanceClock, last } = setup();
    client.start();
    last().open();
    last().deliver({ type: "lane", state: "live" });
    client.onHidden();
    advanceClock(120_000);
    client.onVisible();
    client.stop();

    for (const socket of FakeSocket.instances) {
      expect(socket.sent).toEqual([]);
    }
  });
});
