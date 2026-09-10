/**
 * The subset of the WebSocket API this app uses. The renderer passes the
 * browser's global WebSocket; tests pass ws's Node client. Both satisfy it.
 */
export interface SocketLike {
  binaryType: string;
  readonly bufferedAmount: number;
  readonly readyState: number;
  send(data: ArrayBuffer | ArrayBufferView | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "stopped";

/** The close code/reason a socket went down with, as reported by the server. */
export interface CloseInfo {
  code: number;
  reason: string;
}

const BACKOFF_LADDER = [250, 500, 1000, 2000, 4000, 8000] as const;

/** 250 ms doubling to a 8 s ceiling. */
export function backoffMs(attempt: number): number {
  const index = Math.min(Math.max(0, Math.trunc(attempt)), BACKOFF_LADDER.length - 1);
  return BACKOFF_LADDER[index]!;
}

export interface ReconnectingSocketOptions {
  url: string;
  factory: SocketFactory;
  /** Returns a cancel function. Tests substitute an immediate scheduler. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /**
   * Decides whether a close should be retried at all. Defaults to always
   * retrying, which is correct for a generic drop. A caller with
   * protocol-specific knowledge — e.g. the ingest gateway's 4401 (bad token,
   * can never succeed) and 4409 (superseded by a newer connection, retrying
   * would just fight it) — can return false to end the retry loop instead.
   * Not called for connection failures with no close frame (e.g. ECONNREFUSED),
   * which are reported as `{ code: 0, reason: "" }` and always default-retry.
   */
  shouldReconnect?: (info: CloseInfo) => boolean;
}

/**
 * Keeps one WebSocket alive. It never throws at its caller: a dead socket is a
 * state change, not an exception, because the audio capture graph must keep
 * running (and the level meter must keep moving) while the server is missing.
 */
export class ReconnectingSocket {
  private readonly opts: Required<ReconnectingSocketOptions>;
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  private readonly messageListeners = new Set<(data: unknown) => void>();

  private current: SocketLike | undefined;
  private cancelRetry: (() => void) | undefined;
  private currentState: ConnectionState = "idle";
  private retryAttempts = 0;

  constructor(options: ReconnectingSocketOptions) {
    this.opts = {
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
      shouldReconnect: () => true,
      ...options,
    };
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  /** The live socket, or undefined when not open. */
  get socket(): SocketLike | undefined {
    return this.currentState === "open" ? this.current : undefined;
  }

  /** Number of connection attempts made, including the first. */
  get attempts(): number {
    return this.retryAttempts;
  }

  onState(fn: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }

  onMessage(fn: (data: unknown) => void): () => void {
    this.messageListeners.add(fn);
    return () => {
      this.messageListeners.delete(fn);
    };
  }

  start(): void {
    if (this.currentState === "connecting" || this.currentState === "open") return;
    this.retryAttempts = 0;
    this.connect();
  }

  stop(): void {
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    const socket = this.current;
    this.current = undefined;
    try {
      socket?.close(1000, "operator stopped");
    } catch {
      // A socket that is already dead is exactly what we wanted.
    }
    this.setState("stopped");
  }

  private setState(next: ConnectionState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    for (const fn of this.stateListeners) {
      try {
        fn(next);
      } catch (err) {
        console.error("socket state listener threw", err);
      }
    }
  }

  private connect(): void {
    this.retryAttempts++;
    this.setState("connecting");

    let socket: SocketLike;
    try {
      socket = this.opts.factory(this.opts.url);
    } catch (err) {
      console.error("socket factory threw", err);
      this.scheduleReconnect();
      return;
    }

    socket.binaryType = "arraybuffer";
    this.current = socket;

    const onOpen = () => {
      if (this.current !== socket) return;
      this.retryAttempts = 0;
      this.setState("open");
    };

    const onMessage = (event: { data?: unknown }) => {
      if (this.current !== socket) return;
      for (const fn of this.messageListeners) {
        try {
          fn(event.data);
        } catch (err) {
          console.error("socket message listener threw", err);
        }
      }
    };

    // Registered for both "close" and "error": a failed connection attempt
    // (e.g. ECONNREFUSED) fires "error" with no close code, a graceful
    // server-initiated close fires "close" with one. Either way the socket is
    // down and the `this.current !== socket` guard makes whichever fires
    // first authoritative — a socket replaced mid-flight (by a fresh connect
    // already under way) cannot have its stale close/error attributed to its
    // successor.
    const onDown = (event?: { code?: number; reason?: string }) => {
      if (this.current !== socket) return;
      this.current = undefined;
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onDown);
      socket.removeEventListener("error", onDown);
      if (this.currentState === "stopped") return;

      const info: CloseInfo = { code: event?.code ?? 0, reason: event?.reason ?? "" };
      if (!this.opts.shouldReconnect(info)) {
        this.cancelRetry?.();
        this.cancelRetry = undefined;
        this.setState("stopped");
        return;
      }
      this.scheduleReconnect();
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onDown);
    socket.addEventListener("error", onDown);
  }

  private scheduleReconnect(): void {
    if (this.currentState === "stopped") return;
    this.setState("reconnecting");
    this.cancelRetry?.();
    this.cancelRetry = this.opts.schedule(() => {
      this.cancelRetry = undefined;
      if (this.currentState === "stopped") return;
      this.connect();
    }, backoffMs(this.retryAttempts));
  }
}
