import type { LangCode, LaneState } from "@tongyeok/protocol";
import type { TranscriptBus } from "../transcript-bus.ts";

/** Anything AudioHub can hand ingest PCM to. */
export interface PcmConsumer {
  readonly lang: LangCode;
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

/** Fixed-capacity FIFO that discards the oldest entry under pressure. */
export class BoundedFrameQueue {
  private readonly items: Buffer[] = [];
  private dropped = 0;

  constructor(private readonly capacity: number) {}

  get drops(): number {
    return this.dropped;
  }

  get length(): number {
    return this.items.length;
  }

  push(frame: Buffer): void {
    if (this.items.length >= this.capacity) {
      this.items.shift();
      this.dropped++;
    }
    this.items.push(frame);
  }

  shift(): Buffer | undefined {
    return this.items.shift();
  }
}
