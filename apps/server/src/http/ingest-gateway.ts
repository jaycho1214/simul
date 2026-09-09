import { createHash, timingSafeEqual } from "node:crypto";
import { INGEST_FRAME_BYTES } from "../constants.ts";
import type { AudioHub } from "../audio-hub.ts";

export interface WebSocketLike {
  on(event: "message" | "close", fn: (arg: any) => void): void;
  close(code?: number, reason?: string): void;
}

/**
 * Constant-time token comparison. The ingest token is the server's only
 * authorization boundary, so a plain `!==` (which short-circuits on the
 * first mismatched byte) or a length check followed by `timingSafeEqual`
 * (which leaks the true token's length) are both unacceptable here. Hashing
 * both sides first collapses them to fixed-length digests, so the compare
 * that follows leaks neither a byte offset nor the secret's length.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * `ws` delivers a message payload as `Buffer` (the default `binaryType`),
 * `ArrayBuffer`, or `Buffer[]` (fragments), depending on how the socket was
 * configured. Normalizing to a single `Buffer` here means a non-default
 * `binaryType` degrades to "frame doesn't match the expected length"
 * instead of every legitimate 640-byte frame silently failing a
 * `Buffer.isBuffer` check and being dropped as if no operator were
 * connected at all. Falls back to an empty buffer (never throws) so an
 * unexpected payload shape is just another frame that fails the length
 * check, not an exception that tears down the connection.
 */
function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  try {
    return Buffer.from(data as ArrayBuffer);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Single-client PCM ingest. The operator app is the only legitimate caller, so
 * a reconnecting instance takes over and the stale socket is dropped rather
 * than locked out.
 */
export class IngestGateway {
  private active: WebSocketLike | undefined;
  private frames = 0;
  private dropped = 0;

  constructor(private readonly opts: { hub: AudioHub; token: string }) {}

  get connected(): boolean {
    return this.active !== undefined;
  }

  get framesReceived(): number {
    return this.frames;
  }

  /**
   * Frames received on the active connection that did not match the
   * expected size. The diagnostic that distinguishes "operator connected
   * but streaming garbage" (wrong sample rate, wrong channel, a mis-set
   * frame size) from "no operator connected" — both otherwise look
   * identical as `framesReceived === 0`.
   */
  get framesDropped(): number {
    return this.dropped;
  }

  handleConnection(ws: WebSocketLike, url: URL): void {
    const provided = url.searchParams.get("token") ?? "";
    if (!tokensMatch(provided, this.opts.token)) {
      ws.close(4401, "unauthorized");
      return;
    }

    if (this.active) {
      this.active.close(4409, "superseded by a newer ingest connection");
    }
    this.active = ws;

    ws.on("message", (data: unknown) => {
      // A frame already in flight on a since-superseded socket must not be
      // mixed into the live PCM stream.
      if (this.active !== ws) return;

      const buf = toBuffer(data);
      if (buf.length !== INGEST_FRAME_BYTES) {
        this.dropped++;
        return;
      }
      this.frames++;
      this.opts.hub.push(buf);
    });

    ws.on("close", () => {
      // Only clear `active` if this is still the active socket — a stale
      // socket's late close must not wipe out a connection that already
      // took over.
      if (this.active === ws) this.active = undefined;
    });
  }
}
