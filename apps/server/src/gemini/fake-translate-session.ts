import type { LangCode } from "@tongyeok/protocol";
import type {
  TranslateSession,
  TranslateSessionEvents,
  TranslateSessionFactory,
} from "./translate-session.ts";

const FRAMES_PER_UTTERANCE = 25; // 500 ms
const OUT_BYTES_PER_UTTERANCE = 24000; // 500 ms @ 24 kHz mono s16le

/**
 * Deterministic stand-in for the Gemini Live session. Emits one audio chunk and
 * one transcript line per 500 ms of input, so every downstream unit can be
 * tested without network access, an API key, or wall-clock waits.
 */
export class FakeTranslateSession implements TranslateSession {
  private readonly handlers: {
    [K in keyof TranslateSessionEvents]: Array<TranslateSessionEvents[K]>;
  } = { audio: [], transcript: [], state: [], closed: [] };

  private frames = 0;
  private utterances = 0;
  private opened = false;
  private closed = false;
  private saturated = false;

  constructor(readonly targetLanguage: LangCode) {}

  on<K extends keyof TranslateSessionEvents>(event: K, fn: TranslateSessionEvents[K]): void {
    this.handlers[event].push(fn);
  }

  canAccept(): boolean {
    return !this.closed && !this.saturated;
  }

  sendPcm16k(_frame: Buffer): void {
    if (this.closed) return;
    if (!this.opened) {
      this.opened = true;
      for (const fn of this.handlers.state) fn("live");
    }

    if (++this.frames < FRAMES_PER_UTTERANCE) return;

    this.frames = 0;
    this.utterances++;

    // Deterministic non-zero fill: every downstream consumer (lanes, the Opus
    // encoder, FrameBus, the e2e smoke test) processes this buffer, so it must
    // not be all-zero silence — that's the exact failure class that let a
    // segfaulting encoder go undetected for four tasks.
    const pcm = Buffer.alloc(OUT_BYTES_PER_UTTERANCE, this.utterances % 256);
    for (const fn of this.handlers.audio) fn(pcm);

    const text = `${this.targetLanguage} utterance ${this.utterances}`;
    for (const fn of this.handlers.transcript) fn(text, true);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.handlers.closed) fn("closed by caller");
  }

  /**
   * Test hook: simulate the server announcing an imminent disconnect. No
   * production path may reach this — it exists so SessionRotator's
   * make-before-break behaviour can be exercised without a live Gemini
   * connection.
   */
  simulateGoAway(): void {
    if (this.closed) return;
    for (const fn of this.handlers.state) fn("reconnecting");
  }

  /**
   * Test hook: simulate the connection dying without a close() call. No
   * production path may reach this — it exists so SessionRotator's
   * unsolicited-disconnect handling can be exercised without a live Gemini
   * connection.
   */
  simulateDeath(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.handlers.closed) fn(reason);
  }

  /**
   * Test hook: simulate a transport-level error the session survives — what
   * `GeminiTranslateSession` emits from the SDK's `onerror` callback. No
   * production path may reach this.
   *
   * This hook exists because until it did, `"live"` was the only `LaneState`
   * any test could ever observe through the fake: `sendPcm16k` emitted it and
   * nothing else emitted anything but `"reconnecting"`. A lane-state defect
   * that only shows up as `"error"` was therefore invisible to a suite of 130
   * passing tests — which is exactly how C3 shipped.
   */
  simulateError(): void {
    if (this.closed) return;
    for (const fn of this.handlers.state) fn("error");
  }

  /**
   * Test hook: simulate a saturated send buffer, the other half of
   * `canAccept()`'s contract. Real sessions refuse frames while their
   * transport is backed up; without this the fake could only ever say "yes"
   * until closed, so nothing downstream that counts refused frames
   * (`Lane.laneDrops`, the operator dashboard) could be exercised at all.
   */
  simulateSaturated(saturated: boolean): void {
    this.saturated = saturated;
  }
}

/**
 * @param onCreate called with each session as it is created, so a test can
 * reach the sessions a lane opened for itself and drive their test hooks —
 * a lane owns its `SessionRotator` privately, so this is the only way to
 * make a lane's session go away, go quiet, or come back.
 */
export function createFakeTranslateSessionFactory(
  onCreate?: (session: FakeTranslateSession) => void,
): TranslateSessionFactory {
  return async ({ targetLanguage }) => {
    const session = new FakeTranslateSession(targetLanguage);
    onCreate?.(session);
    return session;
  };
}
