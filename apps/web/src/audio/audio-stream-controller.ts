/** The subset of HTMLAudioElement this app uses. A real element satisfies it. */
export interface AudioElementLike {
  src: string;
  currentTime: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

import type { AudioController, AudioStatus } from "./audio-controller.ts";

export type { AudioStatus } from "./audio-controller.ts";

export interface AudioStreamControllerOptions {
  element: AudioElementLike;
  /** e.g. "http://192.168.1.4:8080" */
  httpBaseUrl: string;
  lang: string;
  now?: () => number;
  recoveryDelayMs?: number;
  /**
   * The lane's own media clock in seconds, from the server. The only source of
   * truth for how far behind the room this listener actually is — nothing the
   * element exposes can answer that, because `buffered.end` is the demuxer's
   * read-ahead and moves with the playhead. Omit to disable drift correction.
   */
  liveMediaSeconds?: () => Promise<number | null>;
  driftCheckMs?: number;
  maxDriftSec?: number;
}

export function streamUrl(
  httpBaseUrl: string,
  lang: string,
  cacheBuster: number,
): string {
  return `${httpBaseUrl}/stream/${encodeURIComponent(lang)}.webm?t=${cacheBuster}`;
}

const DEFAULT_RECOVERY_DELAY_MS = 1_000;
const DEFAULT_DRIFT_CHECK_MS = 5_000;

/**
 * Lag worth restarting the stream over, as a floor. A listener on this path
 * sits behind the room by the server's prime for as long as they listen, so
 * "too far behind" only means anything relative to that prime — see
 * `maxDriftSecFor`. 8 s is comfortably above the ~3 s prime the default
 * bitrate derives, plus jitter, so an ordinary listener is never disturbed.
 */
const DEFAULT_MAX_DRIFT_SEC = 8;

/** How much further behind than the prime counts as a stall worth a rejoin. */
const DRIFT_HEADROOM_SEC = 5;

/**
 * The drift threshold for a given server prime. The prime is derived from the
 * bitrate on the server (it fills one of Chrome's 32 KiB blocks), so it is not
 * a constant this file can know: at 24 kbps it came to 16 s, past a fixed 8 s
 * threshold, and every listener was rejoined every 5 s for the whole event.
 */
export function maxDriftSecFor(streamPrimeMs: number): number {
  return Math.max(DEFAULT_MAX_DRIFT_SEC, streamPrimeMs / 1000 + DRIFT_HEADROOM_SEC);
}

/**
 * The plain `<audio src>` path: the fallback for browsers that cannot take
 * the stream through MediaSource (see `MseStreamController`). Decode, jitter
 * buffering and loss concealment happen inside the OS media stack behind this
 * element — there is no WASM decoder, no scheduler and no jitter buffer here
 * on purpose, which is also why playback keeps running with the screen off
 * and no wake lock. The cost is latency: the element starts at the oldest
 * byte the server sent (the prime) and can never move forward on an endless,
 * non-seekable response, so that prime is this listener's lag for good.
 */
export class AudioStreamController implements AudioController {
  private readonly element: AudioElementLike;
  private readonly httpBaseUrl: string;
  private readonly lang: string;
  private readonly now: () => number;
  private readonly recoveryDelayMs: number;

  private readonly listeners = new Set<(status: AudioStatus) => void>();
  private readonly bound: Array<[string, (event: Event) => void]> = [];

  private currentStatus: AudioStatus = "idle";
  private muted = false;
  private destroyed = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private driftTimer: ReturnType<typeof setInterval> | undefined;
  private lastCacheBuster = 0;
  private readonly liveMediaSeconds: (() => Promise<number | null>) | undefined;
  private readonly driftCheckMs: number;
  private readonly maxDriftSec: number;

  constructor(opts: AudioStreamControllerOptions) {
    this.element = opts.element;
    this.httpBaseUrl = opts.httpBaseUrl;
    this.lang = opts.lang;
    this.now = opts.now ?? Date.now;
    this.recoveryDelayMs = opts.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS;
    this.liveMediaSeconds = opts.liveMediaSeconds;
    this.driftCheckMs = opts.driftCheckMs ?? DEFAULT_DRIFT_CHECK_MS;
    this.maxDriftSec = opts.maxDriftSec ?? DEFAULT_MAX_DRIFT_SEC;

    this.listen("playing", () => {
      this.cancelRecovery();
      this.setStatus("playing");
    });

    // `stalled` only says bytes stopped arriving, which on this stream is
    // usually the speaker pausing or a brief wifi dip — both of which fix
    // themselves. Re-requesting would make it worse, not better: the server
    // answers every new connection with the same primed backlog, so a rejoin
    // loop replays the last few seconds of the talk into every earpiece in the
    // room until audio resumes. Surface it and wait.
    this.listen("stalled", () => this.setStatus("stalled"));
    this.listen("error", () => this.beginRecovery(false));
    // `ended` means the chunked response actually terminated. Nothing to wait
    // for — re-request now.
    this.listen("ended", () => this.beginRecovery(true));
  }

  get status(): AudioStatus {
    return this.currentStatus;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get currentSrc(): string {
    return this.element.src;
  }

  /** The lag past which playback is restarted at the live edge. */
  get maxDriftSeconds(): number {
    return this.maxDriftSec;
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
   * `play()` throws that grant away. This method performs no async work before
   * calling play().
   */
  start(): Promise<void> {
    this.muted = false;
    this.startDriftChecks();
    this.element.src = streamUrl(
      this.httpBaseUrl,
      this.lang,
      this.nextCacheBuster(),
    );
    return this.play();
  }

  /** Pauses the element, which stops the HTTP stream entirely — a reader who
   *  only wants the transcript costs no audio bandwidth. */
  mute(): void {
    this.muted = true;
    this.cancelRecovery();
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
    this.stopDriftChecks();
    for (const [type, listener] of this.bound) {
      this.element.removeEventListener(type, listener);
    }
    this.bound.length = 0;
    this.element.pause();
    this.currentStatus = "idle";
    this.listeners.clear();
  }

  /**
   * A fresh cache-busted URL, so the browser opens a new request and joins the
   * live edge instead of resuming the stale buffer it was holding.
   */
  private rejoin(): Promise<void> {
    this.cancelRecovery();
    this.element.src = streamUrl(
      this.httpBaseUrl,
      this.lang,
      this.nextCacheBuster(),
    );
    this.element.load();
    return this.play();
  }

  /**
   * Strictly increasing, even for two rejoins inside the same millisecond. A
   * repeated URL would let the browser answer from cache instead of opening a
   * new request, which is exactly what the cache-buster exists to prevent.
   */
  private nextCacheBuster(): number {
    const now = this.now();
    this.lastCacheBuster =
      now > this.lastCacheBuster ? now : this.lastCacheBuster + 1;
    return this.lastCacheBuster;
  }

  private startDriftChecks(): void {
    if (!this.liveMediaSeconds || this.driftTimer !== undefined) return;
    this.driftTimer = setInterval(() => { void this.checkDrift(); }, this.driftCheckMs);
  }

  private stopDriftChecks(): void {
    if (this.driftTimer !== undefined) {
      clearInterval(this.driftTimer);
      this.driftTimer = undefined;
    }
  }

  /**
   * Rejoining is the only way back. The element cannot be seeked — this stream
   * has no Cues and non-seekable I/O, so a seek fails and resumes with no
   * runway — and it cannot speed up without pitching the speaker's voice. A
   * fresh request starts again at the live edge minus the prime.
   */
  private async checkDrift(): Promise<void> {
    if (this.muted || this.destroyed || !this.liveMediaSeconds) return;
    let live: number | null;
    try {
      live = await this.liveMediaSeconds();
    } catch {
      // The stats endpoint is a diagnostic, not a dependency: if it cannot be
      // reached, leave playback exactly as it is.
      return;
    }
    if (live === null || this.muted || this.destroyed) return;
    if (live - this.element.currentTime > this.maxDriftSec) void this.rejoin();
  }

  private play(): Promise<void> {
    return this.element.play().then(
      () => this.setStatus("playing"),
      () => this.setStatus("failed"),
    );
  }

  private beginRecovery(immediate: boolean): void {
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
