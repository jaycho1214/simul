import type { LangCode, LaneState } from "@tongyeok/protocol";
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
  readonly transcripts: TranscriptBus;
  subscribeClusters(fn: (cluster: Buffer) => void): () => void;
  close(): void;
}
