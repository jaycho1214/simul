import type { ServerMessage } from "@tongyeok/protocol";

/**
 * Deliberately without `send`. The listen protocol is server→client only, so
 * the type system, not a code review, is what stops anyone inventing a
 * client→server message.
 */
export interface WebSocketLike {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type ConnectionStatus = "connecting" | "open" | "closed" | "fatal";

export interface ListenClientOptions {
  lang: string;
  /** e.g. "ws://192.168.1.4:8080" */
  wsBaseUrl: string;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  createSocket?: WebSocketFactory;
  reconnectDelaysMs?: readonly number[];
  /** A hide longer than this always forces a reconnect on return. */
  staleAfterHiddenMs?: number;
  now?: () => number;
}

const SERVER_MESSAGE_TYPES = new Set([
  "hello",
  "history",
  "transcript",
  "lane",
  "error",
]);

// Doubles from 500ms to 8s, capped there. Bounded so a saturated wifi AP does
// not get hammered, but short enough that a normal drop (AP roam, a few lost
// packets) recovers within a few seconds. Reset to the front of this list on
// every successful open (see `attempt = 0` in the open handler) so a phone
// that recovers once does not stay stuck at the long end for the rest of the
// event.
const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000] as const;
const WS_OPEN = 1;

export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !SERVER_MESSAGE_TYPES.has(type)) return null;

  return parsed as ServerMessage;
}

export class ListenClient {
  private readonly createSocket: WebSocketFactory;
  private readonly backoff: readonly number[];
  private readonly staleAfterHiddenMs: number;
  private readonly now: () => number;

  private socket: WebSocketLike | undefined;
  /** Bumped on every connect and every drop; stale handlers check it and bail. */
  private generation = 0;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private hiddenAt: number | undefined;
  private currentStatus: ConnectionStatus = "closed";

  constructor(private readonly opts: ListenClientOptions) {
    this.createSocket =
      opts.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike);
    this.backoff = opts.reconnectDelaysMs ?? DEFAULT_BACKOFF;
    this.staleAfterHiddenMs = opts.staleAfterHiddenMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    this.clearTimer();
    this.dropSocket();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.dropSocket();
    this.setStatus("closed");
  }

  onHidden(): void {
    this.hiddenAt = this.now();
  }

  onVisible(): void {
    const hiddenAt = this.hiddenAt;
    this.hiddenAt = undefined;
    if (this.stopped) return;

    const hiddenFor = hiddenAt === undefined ? 0 : this.now() - hiddenAt;
    const looksOpen = this.socket?.readyState === WS_OPEN;

    // A backgrounded socket can be suspended by the browser and keep reporting
    // OPEN while receiving nothing, so readyState alone is not evidence. After
    // a long hide we always rebuild, and the server's `history` message on the
    // fresh connection is what fills the gap.
    if (looksOpen && hiddenFor < this.staleAfterHiddenMs) return;

    this.attempt = 0;
    this.clearTimer();
    this.dropSocket();
    this.connect();
  }

  private connect(): void {
    this.generation++;
    const generation = this.generation;
    this.setStatus("connecting");

    const url = `${this.opts.wsBaseUrl}/listen?lang=${encodeURIComponent(this.opts.lang)}`;
    const socket = this.createSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      this.attempt = 0;
      this.setStatus("open");
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      const message = parseServerMessage(
        (event as Event & { data?: unknown }).data,
      );
      if (!message) return;

      if (message.type === "error") {
        // lane_cap and unknown_language are both answered by the server closing
        // the socket. Retrying in a loop only adds load; the UI offers a retry
        // button that calls start() again.
        this.stopped = true;
        this.clearTimer();
        this.setStatus("fatal");
      }

      this.opts.onMessage(message);
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      this.socket = undefined;
      if (this.stopped) return;
      this.setStatus("closed");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // A close event always follows; reconnect logic lives there only.
    });
  }

  private scheduleReconnect(): void {
    this.clearTimer();
    const index = Math.min(this.attempt, this.backoff.length - 1);
    const delay = this.backoff[index] ?? 8_000;
    this.attempt++;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, delay);
  }

  private dropSocket(): void {
    // Bumping the generation detaches the old handlers before close() fires,
    // so tearing a socket down never triggers a reconnect.
    this.generation++;
    this.socket?.close();
    this.socket = undefined;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.currentStatus === status) return;
    if (this.currentStatus === "fatal" && status !== "connecting") return;
    this.currentStatus = status;
    this.opts.onStatus(status);
  }
}
