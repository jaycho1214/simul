import type { LangCode } from "@simul/protocol";
import type { Clock, TimerHandle } from "../clock.ts";
import type {
  TranslateSession,
  TranslateSessionEvents,
  TranslateSessionFactory,
} from "./translate-session.ts";

/**
 * Two different bounds intentionally share this one constant, because the
 * same real-world fact about Gemini justifies both: "real Gemini Live
 * connects and starts streaming within a couple of seconds under normal
 * conditions."
 *
 * - `rotate()`'s watchdog: how long a pending *replacement* is given to
 *   produce its first audio before it is abandoned and `current` is left
 *   serving.
 * - `start()`'s own timeout: how long the very first connect — the
 *   `factory()` call itself, i.e. the WebSocket handshake — is given before
 *   it is abandoned and rejected. This exists because the installed
 *   `@google/genai` SDK's `Live.connect()` resolves its returned promise
 *   only from the WebSocket's `onopen` event and never rejects it from
 *   `onerror`/`onclose`: a handshake that fails before `onopen` (an invalid
 *   key, a blocked network path, a Gemini-side outage) would otherwise
 *   leave `start()` — and therefore the whole lane, since nothing else is
 *   serving it yet — hanging forever with no error anywhere.
 *
 * 10 s gives generous headroom for network jitter in both cases without
 * leaving an attendee's screen, or a stuck replacement, in limbo for long.
 * A second, near-identical constant just for `start()` would only invite
 * the two to drift apart for no real reason.
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
 * final transcript (a natural utterance boundary), or as soon as possible if
 * the current session dies first. That gives no gap and no duplicate without
 * depending on both sessions crossing an utterance boundary in lockstep.
 *
 * Cutover itself never happens inside an event handler. Handlers only *arm*
 * it (`pendingPromotion`); `sendPcm16k` performs it once both sessions have
 * been fed the frame. Promoting mid-dispatch would move `current` to the
 * replacement while that same frame was still being delivered, so output the
 * replacement produced for it would be forwarded as well as the current
 * session's — two chunks for one utterance. See `sendPcm16k`.
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
  } = { audio: [], transcript: [], state: [], closed: [], usage: [] };

  private current: TranslateSession | undefined;
  private replacement: TranslateSession | undefined;
  /** True once `replacement` has produced its first audio; the cutover still
   * waits for `current`'s next final transcript — or, if `current` has already
   * died, for the end of the frame dispatch in progress. */
  private replacementReady = false;
  /** True once `current` has emitted an unsolicited `closed`. A pending or
   * future replacement should be promoted as soon as it is ready, since
   * there is no longer a `current` to produce a boundary transcript. */
  private currentDead = false;
  /** Armed when a cutover has been decided but must not happen yet: see the
   * class comment and `sendPcm16k`, which is the only place it is acted on. */
  private pendingPromotion = false;
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

  on<K extends keyof TranslateSessionEvents>(event: K, fn: TranslateSessionEvents[K]): void {
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

  /**
   * Opens the very first session for this lane. Unlike `rotate()` — used for
   * every later reconnect — there is no `current` already serving the lane
   * while this settles, so this call has nowhere to fall back to: if it
   * never settles, the lane never exists, and `LaneManager.acquire()` never
   * resolves either. This is exactly the release blocker found live against
   * a real Gemini outage/invalid key (see `ROTATION_TIMEOUT_MS`'s doc
   * comment for the root cause): an attendee's socket sat open with no
   * message, ever, and no row ever appeared for the language on the
   * operator dashboard.
   *
   * Bounded by `ROTATION_TIMEOUT_MS`, via this class's existing `Clock`
   * abstraction (the same mechanism `rotate()`'s watchdog and retry timer
   * already use), rather than a raw `setTimeout` or a second constant. On
   * expiry — or on an ordinary rejection from the factory — this method
   * rejects instead of hanging, so the caller (`TranslatedLane.create`,
   * then `LaneManager.acquire`) sees a real failure and its own callers
   * (`ListenSocket`, `StreamRoute`) reach their existing generic-error
   * paths: a bilingual close for the socket, a 500 for the stream.
   *
   * Deliberately not retried here, unlike `rotate()`'s exponential backoff.
   * That backoff exists to keep an *already-serving* lane quiet through a
   * transient blip while `current` keeps the room fed; there is no
   * equivalent "keep serving silently" state before a lane has ever
   * connected once. Retrying internally here would only trade an infinite,
   * silent hang for a long, still-silent, merely-bounded one — the opposite
   * of "visible failure." Failing fast instead lets the attendee's own next
   * attempt (a reopened connection, or another attendee tapping the same
   * language) start a completely fresh `LaneManager.openLane()` call, which
   * is effectively the same recovery a transient blip needs, just visible
   * and prompt rather than silent and open-ended.
   */
  async start(): Promise<void> {
    const attempt = this.factory({ targetLanguage: this.targetLanguage });
    let timedOut = false;

    // However the race below is decided, `attempt` is not necessarily done
    // settling by the time it is: a timeout wins the race while the factory
    // call is still in flight. Whatever it eventually does, it must not
    // become an unhandled rejection, and a session that finishes connecting
    // after this method has already given up must be closed rather than
    // left dangling — an abandoned Gemini session still runs, and bills,
    // until something closes it, and nothing else ever will.
    attempt.then(
      (session) => {
        if (timedOut) session.close();
      },
      (err) => {
        if (timedOut) {
          console.error(
            `[lane ${this.targetLanguage}] first connect failed after already timing out`,
            err,
          );
        }
      },
    );

    let timer: TimerHandle | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = this.clock.setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `[lane ${this.targetLanguage}] first connect did not complete within ${ROTATION_TIMEOUT_MS}ms`,
          ),
        );
      }, ROTATION_TIMEOUT_MS);
    });

    try {
      this.current = await Promise.race([attempt, timeout]);
    } finally {
      if (timer) this.clock.clearTimeout(timer);
    }

    this.attach(this.current);
  }

  /** Wire a session's output through to our subscribers (only ever `current`),
   * track a pending replacement's readiness, and react to lifecycle signals:
   * an announced disconnect, or an unsolicited close on either session. */
  private attach(session: TranslateSession): void {
    session.on("audio", (pcm) => {
      if (session === this.replacement && !this.replacementReady) {
        this.replacementReady = true;
        this.clearWatchdog();
        // `current` is gone, so there is no boundary left to wait for: arm
        // the cutover for the end of this dispatch.
        if (this.currentDead) this.pendingPromotion = true;
      }
      if (this.isOutputActive(session)) this.emit("audio", pcm);
    });

    session.on("transcript", (text, isFinal) => {
      if (!this.isOutputActive(session)) return;
      this.emit("transcript", text, isFinal);
      // Only the current session's boundaries decide a cutover, and only
      // `sendPcm16k` acts on it — never promote from inside a handler.
      if (session === this.current && isFinal && this.replacementReady) {
        this.pendingPromotion = true;
      }
    });

    session.on("state", (s) => {
      if (session !== this.current) return;
      this.emit("state", s);
      if (s === "reconnecting") void this.rotate();
    });

    // Unlike audio and transcripts, never gated on isOutputActive: a
    // replacement whose output is being discarded is still an open, billing
    // connection, and the operator's meter has to say so.
    session.on("usage", (delta) => this.emit("usage", delta));

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
      // An unsolicited death emits `closed`, never `state` — so unless this
      // says so, a lane that has just lost its connection goes on reporting
      // whatever it last reported, usually "live". The operator's dashboard
      // stays green while the room hears nothing.
      this.emit("state", "reconnecting");
      if (!this.replacement) {
        void this.rotate();
      } else if (this.replacementReady) {
        this.pendingPromotion = true; // no boundary will ever come; cut over
      }
      // else: a replacement is already opening but not ready yet — the
      // audio-readiness handler above arms the cutover as soon as it is,
      // since currentDead is now true.
    });
  }

  /** Whose output reaches subscribers. Normally only `current`: a pending
   * replacement is translating the same speech, so forwarding it too would
   * duplicate. The exception is a dead `current` — it will never emit again,
   * so the replacement's output duplicates nothing, and discarding it until
   * the cutover lands would drop real audio. */
  private isOutputActive(session: TranslateSession): boolean {
    if (session === this.current) return true;
    return session === this.replacement && this.currentDead;
  }

  /** Cut over: `replacement` becomes `current`, the old session is closed.
   * Called only from `sendPcm16k`, between frames — never mid-dispatch. */
  private promote(): void {
    this.pendingPromotion = false;
    const old = this.current;
    const next = this.replacement;
    if (!next) return; // the replacement was abandoned before the cutover landed
    this.clearWatchdog();
    this.current = next;
    this.replacement = undefined;
    this.replacementReady = false;
    this.currentDead = false;
    this.rotations++;
    old?.close();
    // The lane is serving again, and only this line can say so. A session
    // emits "live" exactly once, on its first frame — which `next` burned
    // while it was still the replacement, where `attach` correctly suppresses
    // it. It will never emit again. Without this the lane would read
    // "reconnecting" for the rest of the event after its first rotation,
    // which for a real Gemini connection is roughly every ten minutes.
    this.emit("state", "live");
  }

  /** Give up on a pending replacement without promoting it. `current` (if
   * still alive) keeps serving and a future rotation remains possible. If
   * `current` is also gone, try again immediately rather than going dark. */
  private abandonReplacement(): void {
    this.clearWatchdog();
    this.replacement = undefined;
    this.replacementReady = false;
    this.pendingPromotion = false; // nothing left to promote
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
    // The backoff has just saturated: every further attempt waits the full
    // ceiling, which means the factory has been failing long enough that this
    // is no longer a blip. "reconnecting" would still be literally true, but
    // it reads as transient and this is not — the spec's failure table
    // requires a lane in this shape to fail loudly on the operator dashboard,
    // not to sit there looking like it is about to come back. The condition
    // fires exactly once per failure episode, since `retryDelayMs` only
    // crosses into the cap from below once and is reset to
    // INITIAL_RETRY_MS the moment the factory succeeds again.
    if (this.retryDelayMs === MAX_RETRY_MS && delay < MAX_RETRY_MS) {
      this.emit("state", "error");
    }
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
    this.pendingPromotion = false; // nothing left to promote
    this.rotating = false;
    pending.close();
    if (this.currentDead) void this.rotate();
  }

  /**
   * True when at least one of the sessions this rotator is dispatching to can
   * actually take the frame — which is what `sendPcm16k` below does with it.
   *
   * Both halves matter. Consulting the sessions at all is what makes
   * `Lane.laneDrops` mean something: reporting `true` merely because a
   * `current` reference exists let a lane whose connection had died count
   * zero drops while every frame it was handed evaporated. Including
   * `replacement` is what keeps a recovery possible: while `current` is dead
   * the replacement is the only thing that can take audio, and it needs that
   * audio to produce its first output and be promoted. Refusing frames there
   * would strand the lane permanently silent — the failure this whole class
   * exists to prevent.
   */
  canAccept(): boolean {
    if (this.closed) return false;
    return Boolean(this.current?.canAccept()) || Boolean(this.replacement?.canAccept());
  }

  sendPcm16k(frame: Buffer): void {
    if (this.closed) return;
    // Capture `replacement` before dispatching to `current`, so that whichever
    // session was pending when this frame arrived receives it even if one of
    // current's handlers clears the field mid-dispatch. In particular the
    // frame that arms a cutover must still reach the session about to be
    // promoted, or that session would be a frame behind from the moment it
    // takes over.
    const replacement = this.replacement;
    this.current?.sendPcm16k(frame);
    replacement?.sendPcm16k(frame); // both, until cutover
    // Both sessions have now seen this frame and any output it produced has
    // been forwarded (current's) or discarded (the replacement's), judged
    // against a `current` that did not move mid-dispatch. Only now is it
    // safe to cut over.
    if (this.pendingPromotion) this.promote();
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
