import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage } from "@google/genai";
import type { LangCode } from "@tongyeok/protocol";
import type {
  TranslateSession,
  TranslateSessionEvents,
  TranslateSessionFactory,
} from "./translate-session.ts";

export const DEFAULT_MODEL = "gemini-3.5-live-translate-preview";

export class GeminiTranslateSession implements TranslateSession {
  /** Latest handle from SessionResumptionUpdate; read by SessionRotator. */
  resumptionHandle: string | undefined;

  private readonly handlers: {
    [K in keyof TranslateSessionEvents]: Array<TranslateSessionEvents[K]>;
  } = { audio: [], transcript: [], state: [], closed: [] };

  private live: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | undefined;
  private opened = false;
  private closed = false;

  constructor(readonly targetLanguage: LangCode) {}

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
    this.live = await opts.ai.live.connect({
      model: opts.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: this.targetLanguage,
          echoTargetLanguage: false,
        },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
      },
      callbacks: {
        onmessage: (message) => this.handleMessage(message),
        onerror: (e) => {
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
          if (this.closed) return;
          this.closed = true;
          this.emit("closed", e?.reason ?? "connection closed");
        },
      },
    });
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

    // `Transcription` carries its own end-of-line flag: "Optional. The bool
    // indicates the end of the transcription." `turnComplete` answers a
    // different question — whether the *model* is done generating — and the
    // SDK explicitly documents `outputTranscription` as "independent to the
    // model turn which means it doesn't imply any ordering between
    // transcription and model turn." So a `finished` transcription arriving
    // with no `turnComplete` is normal, and reading only `turnComplete`
    // published every one of those lines as interim: TranscriptBus stores
    // only finalised lines, so `history()` would stay empty for the whole
    // event and every late joiner would get a blank transcript pane.
    // `finished` is optional, so `turnComplete` remains the fallback for a
    // payload that omits it.
    const transcription = content.outputTranscription;
    if (transcription?.text) {
      this.emit(
        "transcript",
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
    this.live?.close();
    this.emit("closed", "closed by caller");
  }
}

export function createGeminiTranslateSessionFactory(opts: {
  apiKey: string;
  model?: string;
}): TranslateSessionFactory {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;

  return async ({ targetLanguage, resumeHandle }) => {
    const session = new GeminiTranslateSession(targetLanguage);
    await session.connect({ ai, model, ...(resumeHandle ? { resumeHandle } : {}) });
    return session;
  };
}
