import type { LangCode, LaneState } from "@tongyeok/protocol";
import { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { WebMSink } from "../audio/webm-sink.ts";
import { FrameBus } from "../frame-bus.ts";
import { TranscriptBus } from "../transcript-bus.ts";
import type { Clock } from "../clock.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { SessionRotator } from "../gemini/session-rotator.ts";
import type { Lane } from "./lane.ts";
import { pumpPackets } from "./pump-packets.ts";

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
      this.elapsedMs = pumpPackets(this.encoder, this.frames, pcm24k, this.elapsedMs);
    });
    session.on("transcript", (text, isFinal) => {
      this.transcripts.publish(text, isFinal);
    });
    session.on("state", (s) => { this.laneState = s; });
    // No "closed" handler: under R5, `session` here is always a
    // SessionRotator, which only emits "closed" from its own close() — and
    // that is only ever reached via this class's close(), which has already
    // set laneState to "error" by the time the event would arrive.
    // Unsolicited reconnection is absorbed entirely inside the rotator and
    // surfaced to us only through "state" (e.g. "reconnecting"), so there is
    // nothing left for a "closed" handler to do.
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

  /**
   * Frames pushed while `session.canAccept()` was false. `SessionRotator`
   * only reports that once it has been closed, so in practice this counts
   * PCM pushed after this lane's own close() has torn down the session —
   * not backpressure or an audio-quality problem. On the operator dashboard,
   * a rising count means "still receiving ingest audio after teardown," not
   * "audio is degrading" — nothing upstream of close() currently makes
   * canAccept() return false.
   */
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
    if (this.closed) return;
    this.closed = true;
    this.laneState = "error";
    this.session.close();
    this.encoder.close();
  }
}
