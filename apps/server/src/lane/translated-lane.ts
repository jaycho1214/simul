import type { LangCode, LaneState } from "@tongyeok/protocol";
import { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { WebMSink } from "../audio/webm-sink.ts";
import { FrameBus } from "../frame-bus.ts";
import { TranscriptBus } from "../transcript-bus.ts";
import type { Clock } from "../clock.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { SessionRotator } from "../gemini/session-rotator.ts";
import type { Lane } from "./lane.ts";

export interface TranslatedLaneOptions {
  lang: LangCode;
  clock: Clock;
  opusBitrate: number;
  historyLines: number;
  sessionFactory: TranslateSessionFactory;
}

export class TranslatedLane implements Lane {
  readonly frames = new FrameBus();
  readonly transcripts: TranscriptBus;

  private readonly encoder: LaneOpusEncoder;
  private readonly sink: WebMSink;
  private elapsedMs = 0;
  private drops = 0;
  private laneState: LaneState = "starting";
  private closed = false;

  private constructor(
    readonly lang: LangCode,
    private readonly session: TranslateSession,
    opts: TranslatedLaneOptions,
  ) {
    // Gemini returns 24 kHz audio, so this lane encodes at 24 kHz.
    this.encoder = new LaneOpusEncoder(24000, opts.opusBitrate);
    this.sink = new WebMSink({ inputSampleRate: 24000 });
    this.transcripts = new TranscriptBus(opts.clock, opts.historyLines);
    this.frames.subscribe((frame) => this.sink.writeOpus(frame));

    session.on("audio", (pcm24k) => {
      for (const packet of this.encoder.encode(pcm24k)) {
        this.frames.publish(packet, this.elapsedMs);
        this.elapsedMs += 20;
      }
    });
    session.on("transcript", (text, isFinal) => {
      this.transcripts.publish(text, isFinal);
    });
    session.on("state", (s) => { this.laneState = s; });
    session.on("closed", () => {
      if (!this.closed) this.laneState = "reconnecting";
    });
  }

  /**
   * Wraps the factory in a SessionRotator so this lane survives Gemini's
   * ~10-minute connection deaths via make-before-break replacement, rather
   * than opening a single session that eventually dies with no recovery.
   * SessionRotator implements TranslateSession, so nothing else about this
   * lane needs to know the difference.
   */
  static async create(opts: TranslatedLaneOptions): Promise<TranslatedLane> {
    const rotator = new SessionRotator(opts.lang, opts.sessionFactory, opts.clock);
    await rotator.start();
    return new TranslatedLane(opts.lang, rotator, opts);
  }

  get laneDrops(): number {
    return this.drops;
  }

  get state(): LaneState {
    return this.laneState;
  }

  get initSegment(): Buffer {
    return this.sink.initSegment;
  }

  subscribeClusters(fn: (cluster: Buffer) => void): () => void {
    return this.sink.subscribe(fn);
  }

  pushPcm(frame: Buffer): void {
    if (!this.session.canAccept()) {
      this.drops++;
      return;
    }
    this.session.sendPcm16k(frame);
  }

  close(): void {
    this.closed = true;
    this.laneState = "error";
    this.session.close();
    this.encoder.close();
  }
}
