export type AudioStatus = "idle" | "playing" | "muted" | "stalled" | "failed";

/**
 * What the screen needs from whichever audio path is in use. Two exist —
 * `MseStreamController`, which feeds the element through MediaSource
 * Extensions, and `AudioStreamController`, a plain `<audio src>` — and the
 * screen must not care which it was handed; see `createAudioController`.
 */
export interface AudioController {
  readonly status: AudioStatus;
  readonly isMuted: boolean;
  /** MUST be called synchronously from inside the tap that picked the language. */
  start(): Promise<void>;
  mute(): void;
  unmute(): Promise<void>;
  destroy(): void;
  onStatusChange(listener: (status: AudioStatus) => void): () => void;
}
