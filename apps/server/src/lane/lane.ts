import type { LangCode, LaneState } from "@simul/protocol";
import type { TranscriptBus } from "../transcript-bus.ts";

/** Anything AudioHub can hand ingest PCM to. */
export interface PcmConsumer {
  readonly lang: LangCode;
  /** Must not block: AudioHub calls this synchronously for every lane in turn. */
  pushPcm(frame: Buffer): void;
  readonly laneDrops: number;
}

/** A lane as seen by the HTTP layer and the admin dashboard. */
export interface Lane extends PcmConsumer {
  readonly state: LaneState;
  readonly initSegment: Buffer;
  /** Recent clusters to write straight after `initSegment`; see `WebMSink.backlog`. */
  readonly backlog: Buffer;
  /**
   * This lane's media clock in ms — the timestamp of the newest audio it has
   * produced, on the same timeline as the cluster timestamps a client
   * receives. Exists to make latency measurable rather than guessed: a
   * listener's true lag is `mediaMs / 1000 - audio.currentTime`, which no
   * client-side reading can give, since `buffered.end` is only the demuxer's
   * read-ahead and says nothing about how far behind the room the audio is.
   */
  readonly mediaMs: number;
  readonly transcripts: TranscriptBus;
  subscribeClusters(fn: (cluster: Buffer) => void): () => void;
  /**
   * Notifies on every change to `state`, and only on changes. Returns an
   * unsubscribe function.
   *
   * `state` on its own is a getter, so the only way to learn it moved is to
   * ask again — which the admin dashboard does once a second but an attendee's
   * listen socket, which reports lane state exactly once at connect, never
   * does. Without this, a lane that reconnects (Gemini kills a connection
   * roughly every ten minutes) or dies leaves every already-connected
   * attendee reading a status frozen at whatever it was when they joined.
   */
  onStateChange(fn: (state: LaneState) => void): () => void;
  close(): void;
}
