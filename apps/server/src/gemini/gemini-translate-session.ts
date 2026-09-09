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
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      this.resumptionHandle = update.newHandle;
    }

    if (message.goAway) {
      this.emit("state", "reconnecting");
    }

    const content = message.serverContent;
    if (!content) return;

    const outText = content.outputTranscription?.text;
    if (outText) {
      this.emit("transcript", outText, Boolean(content.turnComplete));
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
