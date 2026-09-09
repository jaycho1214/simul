import type { LangCode, LaneState } from "@tongyeok/protocol";
import { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { WebMSink } from "../audio/webm-sink.ts";
import { FrameBus } from "../frame-bus.ts";
import { TranscriptBus } from "../transcript-bus.ts";
import type { Clock } from "../clock.ts";
import type { Lane } from "./lane.ts";

/**
 * Passthrough of the speaker's own language. No Gemini session, no API cost.
 * Its TranscriptBus exists so the HTTP layer is uniform, and stays empty —
 * a source-language transcript would need a dedicated session.
 */
export class SourceLane implements Lane {
  readonly frames = new FrameBus();
  readonly transcripts: TranscriptBus;

  private readonly encoder: LaneOpusEncoder;
  private readonly sink: WebMSink;
  private elapsedMs = 0;
  private closed = false;

  constructor(readonly lang: LangCode, opusBitrate: number, clock: Clock) {
    // The source is relayed straight through at ingest rate: 16 kHz.
    this.encoder = new LaneOpusEncoder(16000, opusBitrate);
    this.sink = new WebMSink({ inputSampleRate: 16000 });
    this.transcripts = new TranscriptBus(clock, 1);
    this.frames.subscribe((frame) => this.sink.writeOpus(frame));
  }

  readonly laneDrops = 0;

  get state(): LaneState {
    return this.closed ? "error" : "live";
  }

  get initSegment(): Buffer {
    return this.sink.initSegment;
  }

  subscribeClusters(fn: (cluster: Buffer) => void): () => void {
    return this.sink.subscribe(fn);
  }

  pushPcm(frame: Buffer): void {
    if (this.closed) return;
    for (const packet of this.encoder.encode(frame)) {
      this.frames.publish(packet, this.elapsedMs);
      this.elapsedMs += 20;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.encoder.close();
  }
}
