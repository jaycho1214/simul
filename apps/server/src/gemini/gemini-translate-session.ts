import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage } from "@google/genai";
import type { LangCode } from "@tongyeok/protocol";
import type { Clock, TimerHandle } from "../clock.ts";
import { splitCompleteSentences } from "./segment-lines.ts";
import type {
  TranslateSession,
  TranslateSessionEvents,
  TranslateSessionFactory,
} from "./translate-session.ts";

export const DEFAULT_MODEL = "gemini-3.5-live-translate-preview";

/**
 * How long the tail of a transcription may go without a new fragment before
 * it is committed as a line of its own.
 *
 * While the speaker talks, the model appends a fragment about once a second
 * (measured 2026-09-11: 1.0 s apart, to within a few tens of ms), so two
 * seconds is a pause, not a slow fragment. It is also the only thing that
 * ends a line in a language that writes no sentence terminators, and what
 * commits the last sentence of a passage — its terminator has nothing after
 * it, so `splitCompleteSentences` alone would hold it until the next one.
 */
export const TRANSCRIPT_IDLE_MS = 2_000;

export class GeminiTranslateSession implements TranslateSession {
  /** Latest handle from SessionResumptionUpdate; read by SessionRotator. */
  resumptionHandle: string | undefined;

  private readonly handlers: {
    [K in keyof TranslateSessionEvents]: Array<TranslateSessionEvents[K]>;
  } = { audio: [], transcript: [], state: [], closed: [] };

  private live: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | undefined;
  private opened = false;
  private closed = false;
  /** Transcription text received since the last line was committed. */
  private pending = "";
  /** Armed while `pending` is non-empty; commits it after TRANSCRIPT_IDLE_MS. */
  private idleTimer: TimerHandle | undefined;

  constructor(
    readonly targetLanguage: LangCode,
    private readonly clock: Clock,
  ) {}

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

  canAccept(): boolean {
    return !this.closed && this.live !== undefined;
  }

  async connect(opts: {
    ai: GoogleGenAI;
    model: string;
    resumeHandle?: string;
  }): Promise<void> {
    // The SDK's `live.connect()` resolves only once the server has answered
    // the setup message, and it never rejects. A socket the server closes
    // first — an invalid API key comes back as close code 1007 with the
    // reason in the frame, about 300 ms in — leaves that promise pending
    // forever, and the only thing that would ever end the wait is
    // SessionRotator's 10 s timeout, which cannot say why. So a close or a
    // handshake error races the connect, and the reason the server gave is
    // the error the operator reads.
    let settled = false;
    let rejectEarly: (err: Error) => void = () => {};
    const failedFirst = new Promise<never>((_, reject) => {
      rejectEarly = reject;
    });

    const connecting = opts.ai.live.connect({
      model: opts.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: this.targetLanguage,
          // There is no source language anywhere in this API: the model
          // detects what is being spoken. A listener on the "en" lane must
          // hear English whether the speaker is translating from Korean or
          // simply speaking English, so speech already in the target language
          // is parroted rather than dropped.
          echoTargetLanguage: true,
        },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
      },
      callbacks: {
        onmessage: (message) => this.handleMessage(message),
        onerror: (e) => {
          if (!settled) {
            this.closed = true;
            rejectEarly(
              new Error(
                `[lane ${this.targetLanguage}] live connect failed: ${e?.message ?? "socket error"}`,
              ),
            );
            return;
          }
          // An error arriving after the session is closed is teardown noise
          // (or a post-mortem for a connection nobody is listening to any
          // more). Emitting `state("error")` for it would break the contract
          // in translate-session.ts, and logging it would fire on every
          // ordinary rotation.
          if (this.closed) return;
          this.emit("state", "error");
          console.error(`[lane ${this.targetLanguage}] live error`, e?.message);
        },
        onclose: (e) => {
          if (!settled) {
            this.closed = true;
            rejectEarly(
              new Error(
                `[lane ${this.targetLanguage}] live connection closed before setup completed: ${
                  e?.reason || `code ${e?.code ?? "unknown"}`
                }`,
              ),
            );
            return;
          }
          if (this.closed) return;
          this.closed = true;
          this.clearIdleTimer();
          this.emit("closed", e?.reason ?? "connection closed");
        },
      },
    });

    // Should the SDK's promise ever resolve after this method gave up, that
    // session is live, billing, and attached to nothing: close it.
    connecting.then(
      (live) => {
        if (this.closed) live.close();
      },
      () => {},
    );

    try {
      this.live = await Promise.race([connecting, failedFirst]);
    } finally {
      settled = true;
    }
  }

  private handleMessage(message: LiveServerMessage): void {
    // Messages already in flight when the connection dies are still delivered
    // after `onclose`. A closed session must be inert — see the contract in
    // translate-session.ts. SessionRotator keeps a dead `current` in place
    // until the cutover lands on the next frame, so anything emitted here
    // would be forwarded alongside the replacement's output: a duplicate in
    // exactly the window make-before-break exists to keep seamless.
    if (this.closed) return;

    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      this.resumptionHandle = update.newHandle;
    }

    if (message.goAway) {
      this.emit("state", "reconnecting");
    }

    const content = message.serverContent;
    if (!content) return;

    // Gemini streams a transcription as a run of fragments — "Hello. Today",
    // " we're going to talk", " about a real-time", " system." — and every
    // layer downstream assumes whole lines: TranscriptBus stores what it is
    // handed as a complete line, the wire protocol carries whole lines, and
    // the attendee app replaces its interim line wholesale on every message.
    // Forwarded verbatim, each fragment replaced the last on screen and a
    // reader saw one word at a time. So the fragments are reassembled here,
    // at the one boundary that knows Gemini's wire format.
    //
    // Where a line ENDS is also decided here, because the API never says.
    // `Transcription.finished` ("the bool indicates the end of the
    // transcription") and `turnComplete` are both honoured when they arrive,
    // but the translate model sends neither — it translates a continuous
    // stream with no turns to close (measured 2026-09-11: none across two
    // sentences and a 45 s pause) — and while the code waited for them, an
    // attendee's transcript was one line that grew for the whole event and
    // never scrolled up. See `segment-lines.ts` and `onTranscription`.
    //
    // During silence the model sends `outputTranscription` with no text at
    // all, about every two seconds. Those carry nothing to append; the pause
    // itself is handled by the idle timer.
    const transcription = content.outputTranscription;
    if (transcription?.text) {
      this.onTranscription(
        transcription.text,
        transcription.finished ?? Boolean(content.turnComplete),
      );
    }

    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.emit("audio", Buffer.from(part.inlineData.data, "base64"));
      }
    }
  }

  /**
   * Appends a fragment, commits every sentence it completes, and republishes
   * the tail as the interim line. The tail is committed by `endOfLine` (the
   * API's own flags, when they come), by the next fragment completing it, or
   * by the idle timer once the speaker has paused.
   */
  private onTranscription(fragment: string, endOfLine: boolean): void {
    this.clearIdleTimer();
    const { done, rest } = splitCompleteSentences(this.pending + fragment);
    for (const sentence of done) this.emit("transcript", sentence, true);
    this.pending = rest;

    if (endOfLine) {
      this.commitPending();
      return;
    }
    const interim = this.pending.trim();
    if (!interim) return;
    this.emit("transcript", interim, false);
    this.idleTimer = this.clock.setTimeout(() => {
      this.idleTimer = undefined;
      // A closed session is inert (see translate-session.ts); the timer is
      // cleared on every close path, but a caller that closes from inside a
      // handler can still race this callback.
      if (!this.closed) this.commitPending();
    }, TRANSCRIPT_IDLE_MS);
  }

  private commitPending(): void {
    this.clearIdleTimer();
    const line = this.pending.trim();
    this.pending = "";
    if (line) this.emit("transcript", line, true);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      this.clock.clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  sendPcm16k(frame: Buffer): void {
    if (!this.live || this.closed) return;
    if (!this.opened) {
      this.opened = true;
      this.emit("state", "live");
    }
    this.live.sendRealtimeInput({
      audio: { data: frame.toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    this.live?.close();
    this.emit("closed", "closed by caller");
  }
}

export function createGeminiTranslateSessionFactory(opts: {
  apiKey: string;
  clock: Clock;
  model?: string;
}): TranslateSessionFactory {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;

  return async ({ targetLanguage, resumeHandle }) => {
    const session = new GeminiTranslateSession(targetLanguage, opts.clock);
    await session.connect({ ai, model, ...(resumeHandle ? { resumeHandle } : {}) });
    return session;
  };
}
