import type { LangCode } from "@tongyeok/protocol";
import type { Clock, TimerHandle } from "../clock.ts";
import type {
  TranslateSession,
  TranslateSessionEvents,
  TranslateSessionFactory,
} from "./translate-session.ts";

/**
 * How long a pending replacement is given to produce its first audio before
 * it is abandoned and `current` is left serving. Real Gemini Live connects
 * and starts streaming within a couple of seconds under normal conditions;
 * 10 s gives generous headroom for network jitter without leaving the lane
 * in limbo for long if the replacement is actually stuck or dead.
 */
export const ROTATION_TIMEOUT_MS = 10_000;

/** Delay before the first retry after a factory rejection. */
export const INITIAL_RETRY_MS = 1_000;
/** Ceiling for the exponential backoff between retries: 1s, 2s, 4s, 8s,
 * 16s, 30s, 30s, ... A persistently failing factory (bad auth, DNS outage)
 * degrades to a slow, quiet retry loop instead of spinning as fast as
 * promises resolve. */
export const MAX_RETRY_MS = 30_000;

/**
 * Make-before-break session replacement. On `state("reconnecting")` — or on
 * the current session dying unsolicited — a replacement session is opened
 * with the current resumption handle and fed the same audio as the current
 * one.
 *
 * The current session is never suppressed: it keeps forwarding audio and
 * transcripts for the entire overlap, since it is the session that is
 * definitely still working. The replacement's output is discarded until
 * cutover, since during the overlap it is translating the same speech and
 * forwarding it too would duplicate. The replacement's first audio only
 * marks it *ready* — the actual switch happens on the current session's next
 * final transcript (a natural utterance boundary), or immediately if the
 * current session dies first. That gives no gap and no duplicate without
 * depending on both sessions crossing an utterance boundary in lockstep.
 *
 * A pending replacement that dies, or that never produces audio within
 * `ROTATION_TIMEOUT_MS`, is abandoned: `current` is left serving and a future
 * rotation remains possible. If `current` was already dead when that
 * happens, a fresh rotation is started immediately rather than leaving the
 * lane silent.
 *
 * Implements `TranslateSession` itself, so `TranslatedLane` cannot tell it
 * apart from a plain session.
 */
export class SessionRotator implements TranslateSession {
  private readonly handlers: {
    [K in keyof TranslateSessionEvents]: Array<TranslateSessionEvents[K]>;
  } = { audio: [], transcript: [], state: [], closed: [] };

  private current: TranslateSession | undefined;
  private replacement: TranslateSession | undefined;
  /** True once `replacement` has produced its first audio; promotion still
   * waits for `current`'s next final transcript (or an immediate death). */
  private replacementReady = false;
  /** True once `current` has emitted an unsolicited `closed`. A pending or
   * future replacement should promote itself the moment it is ready, since
   * there is no longer a `current` to produce a boundary transcript. */
  private currentDead = false;
  /** Guards the window between calling the factory and it resolving, which
   * `replacement` alone cannot cover since it is only set after the await. */
  private rotating = false;
  private watchdog: TimerHandle | undefined;
  /** Backoff for the next retry after a factory rejection; reset to
   * `INITIAL_RETRY_MS` the moment the factory succeeds again. */
  private retryDelayMs = INITIAL_RETRY_MS;
  private retryTimer: TimerHandle | undefined;
  private rotations = 0;
  private closed = false;

  constructor(
    readonly targetLanguage: LangCode,
    private readonly factory: TranslateSessionFactory,
    private readonly clock: Clock,
  ) {}

  /** 0 while the original session is live, incremented at each cutover. */
  get activeIndex(): number {
    return this.rotations;
  }

  on<K extends keyof TranslateSessionEvents>(
    event: K,
    fn: TranslateSessionEvents[K],
  ): void {
    this.handlers[event].push(fn);
  }

  private emit<K extends keyof TranslateSessionEvents>(
    event: K,
    ...args: Parameters<TranslateSessionEvents[K]>
  ): void {
    for (const fn of this.handlers[event]) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  }

  async start(): Promise<void> {
    this.current = await this.factory({ targetLanguage: this.targetLanguage });
    this.attach(this.current);
  }

  /** Wire a session's output through to our subscribers (only ever `current`),
   * track a pending replacement's readiness, and react to lifecycle signals:
   * an announced disconnect, or an unsolicited close on either session. */
  private attach(session: TranslateSession): void {
    session.on("audio", (pcm) => {
      // Check readiness (and possibly promote) before deciding whether to
      // forward: if `current` is already dead, this chunk both proves
      // readiness *and* is the first real output since current went away,
      // so it must be forwarded, not discarded as a would-be duplicate —
      // there is nothing left for it to duplicate.
      if (session === this.replacement && !this.replacementReady) {
        this.replacementReady = true;
        this.clearWatchdog();
        if (this.currentDead) this.promote(); // no boundary to wait on; promote now
      }
      if (session === this.current) {
        this.emit("audio", pcm);
      }
    });

    session.on("transcript", (text, isFinal) => {
      if (session !== this.current) return; // replacement's output is discarded pre-cutover
      this.emit("transcript", text, isFinal);
      if (isFinal && this.replacementReady) this.promote();
    });

    session.on("state", (s) => {
      if (session !== this.current) return;
      this.emit("state", s);
      if (s === "reconnecting") void this.rotate();
    });

    session.on("closed", () => {
      if (this.closed) return; // caller-initiated close; expected, no reconnect

      if (session === this.replacement) {
        // The pending replacement died before it was ever promoted: abandon
        // it and keep `current` serving. Do not leave `replacement` set —
        // that would permanently suppress nothing (current is never
        // suppressed now) but would permanently block future rotations.
        this.abandonReplacement();
        return;
      }
      if (session !== this.current) return; // a stale, already-superseded session

      this.currentDead = true;
      if (!this.replacement) {
        void this.rotate();
      } else if (this.replacementReady) {
        this.promote();
      }
      // else: a replacement is already opening but not ready yet — the
      // audio-readiness handler above will promote it immediately once it
      // is, since currentDead is now true.
    });
  }

  /** Cut over: `replacement` becomes `current`, the old session is closed. */
  private promote(): void {
    const old = this.current;
    const next = this.replacement;
    if (!next) return; // defensive; only called when a replacement is pending
    this.clearWatchdog();
    this.current = next;
    this.replacement = undefined;
    this.replacementReady = false;
    this.currentDead = false;
    this.rotations++;
    old?.close();
  }

  /** Give up on a pending replacement without promoting it. `current` (if
   * still alive) keeps serving and a future rotation remains possible. If
   * `current` is also gone, try again immediately rather than going dark. */
  private abandonReplacement(): void {
    this.clearWatchdog();
    this.replacement = undefined;
    this.replacementReady = false;
    this.rotating = false;
    if (this.currentDead) void this.rotate();
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      this.clock.clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      this.clock.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  /** Schedule another `rotate()` attempt after the current backoff delay,
   * then double the delay (capped) for next time. A factory rejection is
   * entirely plausible in production (auth failure, connection refused, a
   * DNS blip) and must never propagate out of `rotate()` — an unhandled
   * rejection here would take down the whole process, every language lane
   * with it, not just this one. */
  private scheduleRetry(): void {
    if (this.closed) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_MS);
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = undefined;
      void this.rotate();
    }, delay);
  }

  async rotate(): Promise<void> {
    if (this.closed) return;
    if (!this.current) return; // nothing to rotate before start()
    if (this.replacement || this.rotating) return; // a rotation is already in flight

    this.clearRetryTimer(); // this attempt supersedes any pending scheduled retry
    this.rotating = true;
    try {
      const handle = this.current.resumptionHandle;
      let next: TranslateSession;
      try {
        next = await this.factory({
          targetLanguage: this.targetLanguage,
          ...(handle ? { resumeHandle: handle } : {}),
        });
      } catch (err) {
        console.error(
          `[lane ${this.targetLanguage}] failed to open a replacement session; retrying in ${this.retryDelayMs}ms`,
          err,
        );
        this.scheduleRetry();
        return; // current (if still alive) is untouched and keeps serving
      }

      // The factory succeeded: connectivity is proven, so reset backoff.
      this.retryDelayMs = INITIAL_RETRY_MS;

      if (this.closed) {
        // The rotator was closed by the caller while the replacement was
        // opening; discard it rather than leaving it dangling.
        next.close();
        return;
      }

      this.replacement = next;
      this.replacementReady = false;
      this.attach(next);
      this.watchdog = this.clock.setTimeout(
        () => this.onWatchdogTimeout(next),
        ROTATION_TIMEOUT_MS,
      );
    } finally {
      this.rotating = false;
    }
  }

  /** The replacement produced no audio within the timeout: give up on it. */
  private onWatchdogTimeout(pending: TranslateSession): void {
    if (this.replacement !== pending) return; // already promoted or abandoned
    this.watchdog = undefined;
    this.replacement = undefined;
    this.replacementReady = false;
    this.rotating = false;
    pending.close();
    if (this.currentDead) void this.rotate();
  }

  canAccept(): boolean {
    return !this.closed && this.current !== undefined;
  }

  sendPcm16k(frame: Buffer): void {
    if (this.closed) return;
    // Capture `replacement` before dispatching to `current`: current's own
    // transcript handler can call promote() synchronously (if this frame
    // completes its final utterance and the replacement is already ready),
    // which clears the `replacement` field. Without capturing first, the
    // freshly-promoted session would never receive the very frame that
    // triggered its promotion.
    const replacement = this.replacement;
    this.current?.sendPcm16k(frame);
    replacement?.sendPcm16k(frame); // both, until cutover
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearWatchdog();
    this.clearRetryTimer();
    this.replacement?.close();
    this.current?.close();
    this.emit("closed", "closed by caller");
  }
}
