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

  async rotate(): Promise<void> {
    if (this.closed) return;
    if (!this.current) return; // nothing to rotate before start()
    if (this.replacement || this.rotating) return; // a rotation is already in flight

    this.rotating = true;
    try {
      const handle = this.current.resumptionHandle;
      const next = await this.factory({
        targetLanguage: this.targetLanguage,
        ...(handle ? { resumeHandle: handle } : {}),
      });

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
    this.current?.sendPcm16k(frame);
    this.replacement?.sendPcm16k(frame); // both, until cutover
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearWatchdog();
    this.replacement?.close();
    this.current?.close();
    this.emit("closed", "closed by caller");
  }
}
