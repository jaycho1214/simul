import type { AudioUsage, LangCode, LaneState } from "@simul/protocol";

export interface TranslateSessionEvents {
  /**
   * Tokens Gemini has just charged for, as a delta: the Live API reports
   * usage about once a second, each report covering only what arrived since
   * the last. Emitted for every connection that is open, whether or not its
   * output is being forwarded — a replacement session overlapping the one
   * it replaces bills just the same.
   */
  usage: (delta: AudioUsage) => void;
  /** Translated speech, 16-bit PCM mono at 24 kHz. */
  audio: (pcm24k: Buffer) => void;
  /**
   * `text` is the whole line so far, never the piece that just arrived.
   *
   * This is the contract every consumer downstream already relies on:
   * TranscriptBus stores a final line verbatim as history, the wire protocol
   * carries whole lines, and the attendee app replaces its interim line
   * wholesale on each message. An implementation whose upstream streams
   * fragments — Gemini's does — must reassemble them before emitting, or a
   * reader sees one word at a time and no line ever scrolls up.
   */
  transcript: (text: string, isFinal: boolean) => void;
  state: (state: LaneState) => void;
  closed: (reason: string) => void;
}

/**
 * A live translation connection.
 *
 * **A closed session must be inert.** Once it has emitted `closed` — for any
 * reason, caller-initiated or not — an implementation must emit no further
 * `audio`, `transcript` or `state`, even for data that was already in flight
 * when the connection died. `SessionRotator` overlaps two sessions and leaves
 * a dead one in place until the cutover lands, so a late event from a closed
 * session is forwarded alongside its replacement's output: one utterance
 * delivered twice, in exactly the window make-before-break exists to keep
 * seamless. Guard the transport's own callbacks, not just the send path.
 */
export interface TranslateSession {
  readonly targetLanguage: LangCode;
  /** Latest session-resumption handle, when the implementation supports one. */
  readonly resumptionHandle?: string;
  /** False when the session is closed or its send buffer is saturated. */
  canAccept(): boolean;
  /** One 640-byte frame of 16 kHz mono s16le. */
  sendPcm16k(frame: Buffer): void;
  close(): void;
  on<K extends keyof TranslateSessionEvents>(event: K, fn: TranslateSessionEvents[K]): void;
}

export type TranslateSessionFactory = (opts: {
  targetLanguage: LangCode;
  /** Supplied by SessionRotator when replacing a dying connection. */
  resumeHandle?: string;
}) => Promise<TranslateSession>;
