import type { AudioController, AudioStatus } from "./audio-controller.ts";
import { streamUrl } from "./audio-stream-controller.ts";

/** Exactly what `WebMSink` writes: Opus in WebM, one mono track. */
export const OPUS_WEBM_MIME = 'audio/webm; codecs="opus"';

export interface TimeRangesLike {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

/** The subset of HTMLAudioElement this path uses. A real element satisfies it. */
export interface MseElementLike {
  src: string;
  currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly buffered: TimeRangesLike;
  playbackRate: number;
  /** Present on every current browser; guarded anyway, since a fake may omit it. */
  preservesPitch?: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface SourceBufferLike {
  readonly updating: boolean;
  appendBuffer(data: BufferSource): void;
  remove(start: number, end: number): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface MediaSourceLike {
  addSourceBuffer(type: string): SourceBufferLike;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface MseStreamControllerOptions {
  element: MseElementLike;
  /** e.g. "http://192.168.1.4:8080" */
  httpBaseUrl: string;
  lang: string;
  createMediaSource?: () => MediaSourceLike;
  createObjectUrl?: (source: MediaSourceLike) => string;
  revokeObjectUrl?: (url: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How far behind the newest audio playback is held, in seconds. */
  targetLagSec?: number;
  maxTargetLagSec?: number;
  /** Added to the target on every underrun, up to `maxTargetLagSec`. */
  lagStepSec?: number;
  /** After this long without an underrun, the target narrows by one step. */
  lagRecoverAfterMs?: number;
  /** How much each recovery step takes back off the target, never below the initial. */
  lagRecoverStepSec?: number;
  /** Lag beyond target + this is skipped over rather than played out. */
  catchUpSlackSec?: number;
  /** Lag beyond target + this, but within the seek slack, is played out at `catchUpRate`. */
  rateSlackSec?: number;
  catchUpRate?: number;
  /** Audio older than this behind the playhead is dropped from the buffer. */
  keepBehindSec?: number;
  governorMs?: number;
  recoveryDelayMs?: number;
}

/**
 * Whether this browser can take the lane's stream through MediaSource
 * Extensions. False on a browser without the API (iPhone Safari before 17.1
 * offers none; jsdom offers none) and on one that has it but cannot demux
 * Opus in WebM — either way the plain `<audio src>` path still works.
 */
export function mseSupported(
  ctor: unknown = (globalThis as { MediaSource?: unknown }).MediaSource,
): boolean {
  if (typeof ctor !== "function") return false;
  const isTypeSupported = (ctor as { isTypeSupported?: unknown }).isTypeSupported;
  if (typeof isTypeSupported !== "function") return false;
  try {
    return isTypeSupported.call(ctor, OPUS_WEBM_MIME) === true;
  } catch {
    return false;
  }
}

/**
 * The runway: how far behind the newest audio playback is held. 0.6 s covers
 * the 40 ms cluster cadence plus ordinary wifi jitter with room to spare, and
 * the governor widens it on every underrun, so a phone in a bad spot settles
 * at whatever its wifi actually needs rather than everyone paying for the
 * worst seat. Measured on the passthrough lane with a 0.5 s target: 0.63 s
 * behind the lane clock, no stalls.
 */
const DEFAULT_TARGET_LAG_SEC = 0.6;
const DEFAULT_MAX_TARGET_LAG_SEC = 3.0;
const DEFAULT_LAG_STEP_SEC = 0.5;
/**
 * The way back down. Widening is instant, because an underrun is audible;
 * narrowing is slow and stepwise, because it is a bet that the connection
 * has improved, and losing it is another audible stall. Ninety seconds
 * without an underrun buys back a quarter second, so a hiccup at the door
 * no longer costs a phone half a second for the rest of a two-hour event,
 * while a phone in a bad spot settles at whatever runway actually holds
 * there — each underrun restarts the clock — instead of bouncing between
 * stalls and the floor. Never below the initial target: that floor is set
 * by the model's 250 ms output chunks (measured 2026-09-11: gaps of 250 ms
 * median, 331 ms max), which no amount of good wifi changes.
 */
const DEFAULT_LAG_RECOVER_AFTER_MS = 90_000;
const DEFAULT_LAG_RECOVER_STEP_SEC = 0.25;
/**
 * A background tab, a phone lock, a long stall: anything that leaves the
 * playhead more than this far past the target is skipped over. A seek is a
 * seam in the audio, so it is spent only when the alternative is staying
 * seconds behind.
 */
const DEFAULT_CATCH_UP_SLACK_SEC = 1.5;
/**
 * Smaller drift — the ~250 ms between placing the playhead and `play()`
 * actually starting, or a stall Chrome recovered from on its own — is played
 * out a few percent fast with the pitch preserved, which nobody in a hall can
 * hear, until the lag is back on target. Engages past this slack; releases
 * once the target itself is reached, so it does not chatter around the edge.
 */
const DEFAULT_RATE_SLACK_SEC = 0.15;
const DEFAULT_CATCH_UP_RATE = 1.05;
const DEFAULT_KEEP_BEHIND_SEC = 30;
/** Trim in whole chunks rather than shaving a cluster every second. */
const TRIM_HYSTERESIS_SEC = 5;
const DEFAULT_GOVERNOR_MS = 1_000;
const DEFAULT_RECOVERY_DELAY_MS = 1_000;

type Op =
  | { kind: "append"; data: Uint8Array<ArrayBuffer> }
  | { kind: "remove"; start: number; end: number };

/**
 * One attachment of one MediaSource to the element, from `src =` to the
 * moment a rejoin, mute or destroy replaces it. Every callback checks that
 * its session is still the live one before touching anything: a chunk that
 * lands after a mute, or a `sourceopen` for a source already detached, is
 * simply ignored.
 */
interface Session {
  readonly source: MediaSourceLike;
  readonly url: string;
  readonly abort: AbortController;
  readonly queue: Op[];
  readonly cleanup: Array<() => void>;
  buffer: SourceBufferLike | undefined;
  /** Whether the playhead has been placed near the live edge yet. */
  positioned: boolean;
}

/**
 * The low-latency audio path: the page downloads `GET /stream/<lang>.webm`
 * itself and hands the bytes to a SourceBuffer as they arrive.
 *
 * Why not a plain `<audio src>`? Chrome feeds that element's demuxer only in
 * whole 32 KiB blocks (`MultiBufferDataSource`), so the listener sits behind
 * the room by however long a block takes to fill on the wire — 3 s at
 * 128 kbps, 16 s at 24 kbps — for as long as they listen, and can never seek
 * forward on an endless, non-seekable response to make it up. Through MSE the
 * demuxer sees every 100 ms cluster the moment it lands, the buffered range
 * carries the lane's own timestamps, and the playhead can be put wherever we
 * like in it. Decode and output still belong to the media element, so
 * background playback with the screen off is unchanged.
 *
 * Latency here is a policy, not an accident: `targetLagSec` behind the newest
 * appended audio, widened by `lagStepSec` on every underrun and narrowed back
 * by `lagRecoverStepSec` for every `lagRecoverAfterMs` without one, played
 * out a few percent fast (pitch preserved) whenever the playhead slips more
 * than `rateSlackSec` past it, and skipped back to it outright past
 * `catchUpSlackSec`.
 */
export class MseStreamController implements AudioController {
  private readonly element: MseElementLike;
  private readonly httpBaseUrl: string;
  private readonly lang: string;
  private readonly createMediaSource: () => MediaSourceLike;
  private readonly createObjectUrl: (source: MediaSourceLike) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly initialTargetLag: number;
  private readonly maxTargetLag: number;
  private readonly lagStep: number;
  private readonly lagRecoverAfterMs: number;
  private readonly lagRecoverStep: number;
  private readonly catchUpSlack: number;
  private readonly rateSlack: number;
  private readonly catchUpRate: number;
  private readonly keepBehind: number;
  private readonly governorMs: number;
  private readonly recoveryDelayMs: number;

  private readonly listeners = new Set<(status: AudioStatus) => void>();
  private readonly bound: Array<[string, (event: Event) => void]> = [];

  private session: Session | undefined;
  private targetLag: number;
  /** When the target may next narrow; pushed out by every underrun. */
  private nextRecoverAt = Infinity;
  private currentStatus: AudioStatus = "idle";
  private muted = false;
  private destroyed = false;
  private rebuffering = false;
  private catchingUp = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private governorTimer: ReturnType<typeof setInterval> | undefined;
  private lastCacheBuster = 0;

  constructor(opts: MseStreamControllerOptions) {
    this.element = opts.element;
    this.httpBaseUrl = opts.httpBaseUrl;
    this.lang = opts.lang;
    this.createMediaSource =
      opts.createMediaSource ?? (() => new MediaSource() as unknown as MediaSourceLike);
    this.createObjectUrl =
      opts.createObjectUrl ?? ((source) => URL.createObjectURL(source as unknown as MediaSource));
    this.revokeObjectUrl = opts.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.targetLag = opts.targetLagSec ?? DEFAULT_TARGET_LAG_SEC;
    this.initialTargetLag = this.targetLag;
    this.maxTargetLag = opts.maxTargetLagSec ?? DEFAULT_MAX_TARGET_LAG_SEC;
    this.lagStep = opts.lagStepSec ?? DEFAULT_LAG_STEP_SEC;
    this.lagRecoverAfterMs = opts.lagRecoverAfterMs ?? DEFAULT_LAG_RECOVER_AFTER_MS;
    this.lagRecoverStep = opts.lagRecoverStepSec ?? DEFAULT_LAG_RECOVER_STEP_SEC;
    this.catchUpSlack = opts.catchUpSlackSec ?? DEFAULT_CATCH_UP_SLACK_SEC;
    this.rateSlack = opts.rateSlackSec ?? DEFAULT_RATE_SLACK_SEC;
    this.catchUpRate = opts.catchUpRate ?? DEFAULT_CATCH_UP_RATE;
    this.keepBehind = opts.keepBehindSec ?? DEFAULT_KEEP_BEHIND_SEC;
    this.governorMs = opts.governorMs ?? DEFAULT_GOVERNOR_MS;
    this.recoveryDelayMs = opts.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS;

    this.listen("playing", () => {
      this.cancelRecovery();
      this.setStatus("playing");
    });
    // `waiting` with no seek in flight means the playhead caught the buffered
    // edge: the runway is gone. See onWaiting.
    this.listen("waiting", () => this.onWaiting());
    this.listen("error", () => this.beginRecovery(this.session, false));
  }

  get status(): AudioStatus {
    return this.currentStatus;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** How far behind the newest audio playback is currently held, in seconds. */
  get targetLagSeconds(): number {
    return this.targetLag;
  }

  onStatusChange(listener: (status: AudioStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * MUST be called synchronously from inside the tap that picked the language.
   * iOS grants playback only from within a user gesture, and any `await` before
   * `play()` throws that grant away. Nothing here is awaited before play(); the
   * promise it returns simply stays pending until the first audio is buffered.
   */
  start(): Promise<void> {
    this.muted = false;
    this.openSession();
    this.startGovernor();
    return this.play();
  }

  /** Stops the download outright — a reader who only wants the transcript costs no audio bandwidth. */
  mute(): void {
    this.muted = true;
    this.cancelRecovery();
    this.closeSession();
    this.element.pause();
    this.setStatus("muted");
  }

  unmute(): Promise<void> {
    this.muted = false;
    return this.rejoin();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelRecovery();
    this.stopGovernor();
    this.closeSession();
    for (const [type, listener] of this.bound) {
      this.element.removeEventListener(type, listener);
    }
    this.bound.length = 0;
    this.element.pause();
    this.currentStatus = "idle";
    this.listeners.clear();
  }

  /** A fresh MediaSource and a fresh request: the listener lands at the live edge again. */
  private rejoin(): Promise<void> {
    this.cancelRecovery();
    this.closeSession();
    this.openSession();
    this.startGovernor();
    return this.play();
  }

  private openSession(): void {
    const source = this.createMediaSource();
    const session: Session = {
      source,
      url: this.createObjectUrl(source),
      abort: new AbortController(),
      queue: [],
      cleanup: [],
      buffer: undefined,
      positioned: false,
    };
    this.session = session;
    this.rebuffering = false;

    const onOpen = () => {
      if (this.session === session) this.attach(session);
    };
    source.addEventListener("sourceopen", onOpen);
    session.cleanup.push(() => source.removeEventListener("sourceopen", onOpen));

    // The catch-up rate must stretch time, not raise the speaker's voice.
    // True by default in current browsers; set anyway rather than assumed.
    if ("preservesPitch" in this.element) this.element.preservesPitch = true;
    this.element.src = session.url;
  }

  private closeSession(): void {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    this.rebuffering = false;
    this.setRate(1);
    session.abort.abort();
    for (const fn of session.cleanup.splice(0)) fn();
    session.queue.length = 0;
    this.revokeObjectUrl(session.url);
  }

  private attach(session: Session): void {
    let buffer: SourceBufferLike;
    try {
      buffer = session.source.addSourceBuffer(OPUS_WEBM_MIME);
    } catch {
      this.beginRecovery(session, false);
      return;
    }
    session.buffer = buffer;

    const onUpdateEnd = () => {
      if (this.session !== session) return;
      this.pump(session);
      this.position(session);
      this.maybeResume();
    };
    const onError = () => this.beginRecovery(session, false);
    buffer.addEventListener("updateend", onUpdateEnd);
    buffer.addEventListener("error", onError);
    session.cleanup.push(() => {
      buffer.removeEventListener("updateend", onUpdateEnd);
      buffer.removeEventListener("error", onError);
    });

    void this.download(session);
  }

  private async download(session: Session): Promise<void> {
    try {
      const response = await this.fetchImpl(
        streamUrl(this.httpBaseUrl, this.lang, this.nextCacheBuster()),
        { cache: "no-store", signal: session.abort.signal },
      );
      if (this.session !== session) return;
      if (!response.ok || !response.body) {
        this.beginRecovery(session, false);
        return;
      }
      const reader = response.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (this.session !== session) return;
        // The chunked response actually terminated: the server restarted or
        // closed the lane. Nothing to wait for — re-request now.
        if (done) {
          this.beginRecovery(session, true);
          return;
        }
        session.queue.push({ kind: "append", data: value });
        this.pump(session);
      }
    } catch {
      // Our own abort (mute, rejoin, destroy) surfaces here too; only a
      // failure on a session that is still supposed to be running counts.
      if (this.session !== session || session.abort.signal.aborted) return;
      this.beginRecovery(session, false);
    }
  }

  /**
   * A SourceBuffer takes one operation at a time and throws on the second, so
   * every append and remove goes through this queue, one per `updateend`.
   */
  private pump(session: Session): void {
    const buffer = session.buffer;
    if (!buffer || buffer.updating) return;
    const op = session.queue.shift();
    if (!op) return;
    try {
      if (op.kind === "append") buffer.appendBuffer(op.data);
      else buffer.remove(op.start, op.end);
    } catch {
      // QuotaExceededError with nothing left to evict, or an InvalidStateError
      // from a source that closed underneath us. This session cannot go on; a
      // fresh one starts again from the live edge.
      this.beginRecovery(session, false);
    }
  }

  /**
   * The server's first write is the init segment plus a few seconds of
   * backlog. A plain `<audio>` would start at the oldest of it; we wait until
   * a full target of runway is buffered and start one target behind the
   * newest audio instead. (On a stream whose timestamps start at zero the
   * element may begin at 0 on its own an instant earlier; the seek here still
   * lands it in the right place.)
   */
  private position(session: Session): void {
    if (session.positioned) return;
    const edge = this.bufferedEdge();
    if (!edge || edge.end - edge.start < this.targetLag) return;
    session.positioned = true;
    this.element.currentTime = edge.end - this.targetLag;
  }

  private bufferedEdge(): { start: number; end: number } | null {
    const ranges = this.element.buffered;
    if (ranges.length === 0) return null;
    return { start: ranges.start(0), end: ranges.end(ranges.length - 1) };
  }

  /**
   * An underrun. Chrome would resume on its own after a few hundred
   * milliseconds of data — and stall again on the next hiccup, adding each
   * stall's length to the lag for good. Instead: hold, widen the target so
   * this connection gets the runway it evidently needs, and resume only once
   * that much is buffered. The lag ends up exactly one target, not a random
   * accumulation of stalls.
   */
  private onWaiting(): void {
    const session = this.session;
    if (!session || !session.positioned || this.muted || this.destroyed) return;
    if (this.element.seeking || this.rebuffering) return;
    this.rebuffering = true;
    this.targetLag = Math.min(this.targetLag + this.lagStep, this.maxTargetLag);
    this.nextRecoverAt = this.now() + this.lagRecoverAfterMs;
    this.setStatus("stalled");
    this.setRate(1);
    this.element.pause();
  }

  private setRate(rate: number): void {
    if (this.element.playbackRate !== rate) this.element.playbackRate = rate;
    this.catchingUp = rate !== 1;
  }

  private maybeResume(): void {
    if (!this.rebuffering || this.muted || this.destroyed) return;
    const edge = this.bufferedEdge();
    if (!edge || edge.end - this.element.currentTime < this.targetLag) return;
    this.rebuffering = false;
    void this.play();
  }

  private startGovernor(): void {
    if (this.governorTimer !== undefined) return;
    this.governorTimer = setInterval(() => this.govern(), this.governorMs);
  }

  private stopGovernor(): void {
    if (this.governorTimer !== undefined) {
      clearInterval(this.governorTimer);
      this.governorTimer = undefined;
    }
  }

  /**
   * Once a second: hold the lag at the target — a small excess is played out
   * a few percent fast, a large one (a backgrounded tab, a long stall) is
   * skipped over — and drop audio that is far behind the playhead so a
   * two-hour event never fills the buffer.
   */
  private govern(): void {
    const session = this.session;
    if (!session || !session.positioned || this.muted || this.destroyed || this.rebuffering) return;
    const edge = this.bufferedEdge();
    if (!edge) return;

    // Stable for long enough: take one step back toward the initial target.
    // The catch-up below then plays the difference out a few percent fast.
    if (this.targetLag > this.initialTargetLag && this.now() >= this.nextRecoverAt) {
      this.targetLag = Math.max(this.initialTargetLag, this.targetLag - this.lagRecoverStep);
      this.nextRecoverAt = this.now() + this.lagRecoverAfterMs;
    }

    const lag = edge.end - this.element.currentTime;
    if (lag > this.targetLag + this.catchUpSlack) {
      this.setRate(1);
      this.element.currentTime = edge.end - this.targetLag;
    } else if (this.catchingUp ? lag > this.targetLag : lag > this.targetLag + this.rateSlack) {
      this.setRate(this.catchUpRate);
    } else {
      this.setRate(1);
    }

    const cut = this.element.currentTime - this.keepBehind;
    if (edge.start < cut - TRIM_HYSTERESIS_SEC) {
      session.queue.push({ kind: "remove", start: 0, end: cut });
      this.pump(session);
    }
  }

  private beginRecovery(session: Session | undefined, immediate: boolean): void {
    // A failure reported by a session that has already been replaced is
    // history: the live session is the one that matters.
    if (!session || session !== this.session) return;
    if (this.muted || this.destroyed) return;
    this.setStatus("stalled");
    if (immediate) {
      void this.rejoin();
      return;
    }
    if (this.recoveryTimer !== undefined) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (this.muted || this.destroyed) return;
      void this.rejoin();
    }, this.recoveryDelayMs);
  }

  private cancelRecovery(): void {
    if (this.recoveryTimer !== undefined) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }
  }

  /**
   * Strictly increasing, even for two rejoins inside the same millisecond, so
   * the browser can never answer a rejoin from cache.
   */
  private nextCacheBuster(): number {
    const now = this.now();
    this.lastCacheBuster = now > this.lastCacheBuster ? now : this.lastCacheBuster + 1;
    return this.lastCacheBuster;
  }

  private play(): Promise<void> {
    return this.element.play().then(
      () => this.setStatus("playing"),
      () => this.setStatus("failed"),
    );
  }

  private listen(type: string, listener: (event: Event) => void): void {
    this.element.addEventListener(type, listener);
    this.bound.push([type, listener]);
  }

  private setStatus(status: AudioStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of this.listeners) listener(status);
  }
}
