import type { LangCode } from "@tongyeok/protocol";
import type { Clock } from "../clock.ts";
import type {
  TranslateSession,
  TranslateSessionEvents,
  TranslateSessionFactory,
} from "./translate-session.ts";

/**
 * Make-before-break session replacement. On `state("reconnecting")` — or on
 * the current session dying unsolicited — a replacement session is opened
 * with the current resumption handle and fed the same audio as the current
 * one; output switches to the replacement the moment it produces its first
 * audio, so listeners hear no gap and no duplicate.
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
  /** Guards the window between calling the factory and it resolving, which
   * `replacement` alone cannot cover since it is only set after the await. */
  private rotating = false;
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

  /** True only for the single session whose output should reach our
   * subscribers: the current session, and only while no replacement is in
   * flight. During a rotation both sessions are fed input, but neither's
   * output is forwarded until the replacement's first audio triggers cutover. */
  private isOutputActive(session: TranslateSession): boolean {
    return session === this.current && this.replacement === undefined;
  }

  /** Wire a session's output through to our subscribers, and react to its
   * lifecycle signals (an announced disconnect, or an unsolicited close). */
  private attach(session: TranslateSession): void {
    session.on("audio", (pcm) => {
      if (this.isOutputActive(session)) this.emit("audio", pcm);
    });
    session.on("transcript", (text, isFinal) => {
      if (this.isOutputActive(session)) this.emit("transcript", text, isFinal);
    });
    session.on("state", (s) => {
      if (this.isOutputActive(session)) this.emit("state", s);
      if (s === "reconnecting" && session === this.current) void this.rotate();
    });
    session.on("closed", () => {
      if (this.closed) return; // caller-initiated close; expected, no reconnect
      if (session !== this.current) return; // a stale session; ignore
      void this.rotate(); // unsolicited death; reconnect with the stored handle
    });
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
      this.attach(next);

      // Cut over the instant the replacement produces its first audio.
      next.on("audio", (pcm) => {
        if (this.replacement !== next) return; // already cut over, or superseded
        const old = this.current;
        this.current = next;
        this.replacement = undefined;
        this.rotations++;
        this.emit("audio", pcm);
        old?.close();
      });
    } finally {
      this.rotating = false;
    }
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
    this.replacement?.close();
    this.current?.close();
    this.emit("closed", "closed by caller");
  }
}
