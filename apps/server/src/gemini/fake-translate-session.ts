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

  constructor(readonly targetLanguage: LangCode) {}

  on<K extends keyof TranslateSessionEvents>(
    event: K,
    fn: TranslateSessionEvents[K],
  ): void {
    this.handlers[event].push(fn);
  }

  canAccept(): boolean {
    return !this.closed;
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
}

export function createFakeTranslateSessionFactory(): TranslateSessionFactory {
  return async ({ targetLanguage }) => new FakeTranslateSession(targetLanguage);
}
