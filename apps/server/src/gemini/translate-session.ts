import type { LangCode, LaneState } from "@tongyeok/protocol";

export interface TranslateSessionEvents {
  /** Translated speech, 16-bit PCM mono at 24 kHz. */
  audio: (pcm24k: Buffer) => void;
  transcript: (text: string, isFinal: boolean) => void;
  state: (state: LaneState) => void;
  closed: (reason: string) => void;
}

export interface TranslateSession {
  readonly targetLanguage: LangCode;
  /** Latest session-resumption handle, when the implementation supports one. */
  readonly resumptionHandle?: string;
  /** False when the session is closed or its send buffer is saturated. */
  canAccept(): boolean;
  /** One 640-byte frame of 16 kHz mono s16le. */
  sendPcm16k(frame: Buffer): void;
  close(): void;
  on<K extends keyof TranslateSessionEvents>(
    event: K,
    fn: TranslateSessionEvents[K],
  ): void;
}

export type TranslateSessionFactory = (opts: {
  targetLanguage: LangCode;
  /** Supplied by SessionRotator when replacing a dying connection. */
  resumeHandle?: string;
}) => Promise<TranslateSession>;
