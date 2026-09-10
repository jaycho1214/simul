/** The subset of HTMLAudioElement this app uses. A real element satisfies it. */
export interface AudioElementLike {
  src: string;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export type AudioStatus = "idle" | "playing" | "muted" | "stalled" | "failed";

export interface AudioStreamControllerOptions {
  element: AudioElementLike;
  /** e.g. "http://192.168.1.4:8080" */
  httpBaseUrl: string;
  lang: string;
  now?: () => number;
  recoveryDelayMs?: number;
}

export function streamUrl(
  httpBaseUrl: string,
  lang: string,
  cacheBuster: number,
): string {
  return `${httpBaseUrl}/stream/${encodeURIComponent(lang)}.webm?t=${cacheBuster}`;
}

const DEFAULT_RECOVERY_DELAY_MS = 1_000;

/**
 * The entire audio path. Decode, jitter buffering and loss concealment happen
 * inside the OS media stack behind this element — there is no WASM decoder, no
 * scheduler and no jitter buffer here on purpose, which is also why playback
 * keeps running with the screen off and no wake lock.
 */
export class AudioStreamController {
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
  private lastCacheBuster = 0;

  constructor(opts: AudioStreamControllerOptions) {
    this.element = opts.element;
    this.httpBaseUrl = opts.httpBaseUrl;
    this.lang = opts.lang;
    this.now = opts.now ?? Date.now;
    this.recoveryDelayMs = opts.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS;

    this.listen("playing", () => {
      this.cancelRecovery();
      this.setStatus("playing");
    });

    // A dead spot on venue wifi shows up as `stalled`; give the media stack a
    // moment to recover on its own before tearing the request down.
    this.listen("stalled", () => this.beginRecovery(false));
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
