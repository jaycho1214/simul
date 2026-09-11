import type { AudioUsage, LangCode, LaneState } from "@simul/protocol";
import { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { WebMSink } from "../audio/webm-sink.ts";
import { FrameBus } from "../frame-bus.ts";
import { TranscriptBus } from "../transcript-bus.ts";
import type { Clock } from "../clock.ts";
import type { Lane } from "./lane.ts";
import { primeSilence, pumpPackets } from "./pump-packets.ts";

/**
 * The room's own audio, untranslated: the debug lane (`PASSTHROUGH_LANG`),
 * offered only when `passthroughLane` is on. No Gemini session, no API cost.
 * Its TranscriptBus exists so the HTTP layer is uniform, and stays empty.
 */
export class SourceLane implements Lane {
  readonly frames = new FrameBus();
  readonly transcripts: TranscriptBus;
  /** No session, so nothing is ever charged. */
  readonly usage: AudioUsage = Object.freeze({ inputAudioTokens: 0, outputAudioTokens: 0 });

  private readonly encoder: LaneOpusEncoder;
  private readonly sink: WebMSink;
  private readonly stateListeners = new Set<(state: LaneState) => void>();
  private elapsedMs = 0;
  private closed = false;

  constructor(
    readonly lang: LangCode,
    opusBitrate: number,
    clock: Clock,
    streamPrimeMs = 0,
  ) {
    // The source is relayed straight through at ingest rate: 16 kHz.
    this.encoder = new LaneOpusEncoder(16000, opusBitrate);
    this.sink = new WebMSink({ inputSampleRate: 16000, backlogMs: streamPrimeMs });
    this.transcripts = new TranscriptBus(clock, 1);
    this.frames.subscribe((frame) => this.sink.writeOpus(frame));
    this.elapsedMs = primeSilence(this.encoder, this.frames, streamPrimeMs, this.elapsedMs);
  }

  readonly laneDrops = 0;

  get state(): LaneState {
    return this.closed ? "error" : "live";
  }

  get initSegment(): Buffer {
    return this.sink.initSegment;
  }

  get backlog(): Buffer {
    return this.sink.backlog;
  }

  get mediaMs(): number {
    return this.elapsedMs;
  }

  subscribeClusters(fn: (cluster: Buffer) => void): () => void {
    return this.sink.subscribe(fn);
  }

  /**
   * A passthrough lane has exactly one state transition in its life — the
   * one close() makes below — but it still has to offer this, because the
   * HTTP layer serves source and translated lanes through the same code and
   * must not have to ask which kind it is holding.
   */
  onStateChange(fn: (state: LaneState) => void): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }

  pushPcm(frame: Buffer): void {
    if (this.closed) return;
    this.elapsedMs = pumpPackets(this.encoder, this.frames, frame, this.elapsedMs);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.encoder.close();
    // Guarded like every other subscriber dispatch in this codebase
    // (FrameBus, WebMSink, TranscriptBus), and for a sharper reason here:
    // this one runs inside close(), which LaneManager.closeAll() calls in a
    // loop over every open lane. A subscriber that threw would abort that
    // loop and leave the remaining lanes — and their live Gemini sessions —
    // open through a shutdown.
    for (const fn of this.stateListeners) {
      try {
        fn(this.state);
      } catch (err) {
        console.error("lane state subscriber threw", err);
      }
    }
  }
}
