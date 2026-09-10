import {
  ReconnectingSocket,
  type ConnectionState,
  type SocketFactory,
} from "../net/reconnecting-socket.ts";
import { INGEST_FRAME_BYTES } from "./frame-accumulator.ts";

/** Spec: ws://localhost:8080/ingest?token=… — always localhost, never the LAN IP. */
export function ingestUrl(opts: { port: number; token: string }): string {
  return `ws://localhost:${opts.port}/ingest?token=${encodeURIComponent(opts.token)}`;
}

export interface IngestSocketOptions {
  url: string;
  factory: SocketFactory;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Above this much unsent data, drop frames instead of buffering. */
  maxBufferedBytes?: number;
}

/** ~4 s of 16 kHz mono s16le. Past this the operator is not "live" any more. */
const DEFAULT_MAX_BUFFERED_BYTES = 128 * 1024;

/**
 * IngestGateway.handleConnection's two special close codes (see
 * apps/server/src/http/ingest-gateway.ts, the authoritative source for this).
 * Both are terminal for *this* socket: a rejected token cannot succeed by
 * retrying, and retrying after being superseded only fights the operator
 * instance that took over.
 */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_SUPERSEDED = 4409;

/** Why the socket last stopped retrying on its own; cleared by the next start(). */
export type IngestCloseReason = "unauthorized" | "superseded" | undefined;

/**
 * Sends 640-byte PCM frames to the server's IngestGateway. It never buffers
 * without bound and never throws into the audio callback: a frame that cannot be
 * sent right now is dropped and counted, because dropping 20 ms is invisible and
 * accumulating a backlog is not.
 *
 * Close-code handling matches the gateway exactly: 4401 (bad token) and 4409
 * (superseded by a newer operator connection) both stop the retry loop instead
 * of following the ordinary bounded-backoff reconnect. Any other close is an
 * ordinary drop and reconnects with backoff that resets on success.
 */
export class IngestSocket {
  private readonly socket: ReconnectingSocket;
  private readonly maxBufferedBytes: number;
  private sent = 0;
  private dropped = 0;
  private reason: IngestCloseReason = undefined;

  constructor(opts: IngestSocketOptions) {
    this.maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.socket = new ReconnectingSocket({
      url: opts.url,
      factory: opts.factory,
      ...(opts.schedule ? { schedule: opts.schedule } : {}),
      shouldReconnect: (info) => {
        if (info.code === CLOSE_UNAUTHORIZED) {
          this.reason = "unauthorized";
          console.error(
            "ingest: server rejected the token (4401) — will not retry with the same token",
          );
          return false;
        }
        if (info.code === CLOSE_SUPERSEDED) {
          this.reason = "superseded";
          console.warn(
            "ingest: superseded by a newer operator connection (4409) — not retrying against it",
          );
          return false;
        }
        return true;
      },
    });
  }

  get state(): ConnectionState {
    return this.socket.state;
  }

  get sentFrames(): number {
    return this.sent;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  /** Set only when the socket stopped itself on 4401/4409; undefined otherwise. */
  get closeReason(): IngestCloseReason {
    return this.reason;
  }

  onState(fn: (state: ConnectionState) => void): () => void {
    return this.socket.onState(fn);
  }

  start(): void {
    this.reason = undefined;
    this.socket.start();
  }

  stop(): void {
    this.socket.stop();
  }

  /** Returns true when the frame went out, false when it was dropped. */
  sendFrame(frame: ArrayBuffer): boolean {
    if (frame.byteLength !== INGEST_FRAME_BYTES) {
      throw new Error(
        `ingest frames must be exactly ${INGEST_FRAME_BYTES} bytes, got ${frame.byteLength}`,
      );
    }

    const socket = this.socket.socket;
    if (!socket || socket.bufferedAmount > this.maxBufferedBytes) {
      this.dropped++;
      return false;
    }

    try {
      socket.send(frame);
    } catch {
      this.dropped++;
      return false;
    }

    this.sent++;
    return true;
  }
}
