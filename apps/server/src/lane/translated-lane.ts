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
  private readonly stateListeners = new Set<(state: LaneState) => void>();
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
    session.on("state", (s) => this.setState(s));
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
    try {
      return new TranslatedLane(opts.lang, rotator, opts);
    } catch (err) {
      // `start()` has already opened a live, billing Gemini connection. The
      // constructor below it can still throw — `LaneOpusEncoder` rejects a
      // bitrate libopus does not like, for one — and if that throw escapes
      // untouched the rotator ends up in neither `LaneManager.entries` nor
      // its `opening` map: unreachable, so nothing can ever close it, and a
      // fresh one opens for every subsequent attendee tap. The lane cap
      // counts entries, not orphans, so it does not bound them either.
      rotator.close();
      throw err;
    }
  }

  /**
   * Frames this lane was handed but had nowhere to put, because neither the
   * session serving it nor a replacement opening behind it could take them.
   *
   * On the operator dashboard a rising count means audio is being lost right
   * now: the lane's connection has died and its replacement has not arrived
   * yet, or the transport is saturated. Read it alongside `state` — a lane
   * that is "reconnecting" with a climbing drop count is one whose room is
   * hearing silence, and the number says how much of the talk has gone.
   *
   * (It also counts PCM pushed after this lane's own close(), which is
   * harmless and self-limiting: AudioHub drops the lane at the same moment.)
   */
  get laneDrops(): number {
    return this.drops;
  }

  get state(): LaneState {
    return this.laneState;
  }

  onStateChange(fn: (state: LaneState) => void): () => void {
    this.stateListeners.add(fn);
    return () => { this.stateListeners.delete(fn); };
  }

  /**
   * Deduplicated: the underlying session may re-announce a state it is
   * already in (a rotator emits "reconnecting" for each fresh attempt of a
   * failing reconnect), and forwarding those would push an identical
   * `{type:"lane"}` message to every connected attendee for no reason.
   */
  private setState(next: LaneState): void {
    if (next === this.laneState) return;
    this.laneState = next;
    // Guarded like every other subscriber dispatch in this codebase
    // (FrameBus, WebMSink, TranscriptBus), and for a sharper reason here:
    // this runs from close() too, which LaneManager.closeAll() calls in a
    // loop over every open lane. A subscriber that threw would abort that
    // loop and leave the remaining lanes — and their live Gemini sessions —
    // open through a shutdown.
    for (const fn of this.stateListeners) {
      try {
        fn(next);
      } catch (err) {
        console.error("lane state subscriber threw", err);
      }
    }
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
    this.setState("error");
    this.session.close();
    this.encoder.close();
  }
}
