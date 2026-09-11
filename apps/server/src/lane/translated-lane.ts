import type { LangCode, LaneState } from "@tongyeok/protocol";
import { frameBytesFor, LaneOpusEncoder } from "../audio/opus-encoder.ts";
import { WebMSink } from "../audio/webm-sink.ts";
import { FrameBus } from "../frame-bus.ts";
import { TranscriptBus } from "../transcript-bus.ts";
import type { Clock, TimerHandle } from "../clock.ts";
import type { TranslateSession, TranslateSessionFactory } from "../gemini/translate-session.ts";
import { SessionRotator } from "../gemini/session-rotator.ts";
import type { Lane } from "./lane.ts";
import { FRAME_MS, primeSilence, pumpPackets } from "./pump-packets.ts";

/** How often the lane checks that its media clock has kept pace with the wall clock. */
export const FILL_TICK_MS = 100;

/**
 * Once the session has spoken, how far its audio may fall behind the wall
 * clock before the gap is filled with silence.
 *
 * Measured 2026-09-11: the model delivers exactly one second of audio per
 * second and runs a chunk or so ahead, so while it is streaming this deficit
 * never goes positive. A whole second of it is either the connection gone
 * (SessionRotator is already opening a replacement, and the room hears
 * nothing either way) or a stall long enough that the attendee's player has
 * already run dry; filling then costs nothing that was not lost already.
 * Anything much tighter would risk pasting silence into speech on a late
 * chunk, which is audible, and which stays in the timeline for good.
 */
export const FILL_AFTER_MS = 1_000;

export interface TranslatedLaneOptions {
  lang: LangCode;
  clock: Clock;
  opusBitrate: number;
  historyLines: number;
  sessionFactory: TranslateSessionFactory;
  streamPrimeMs?: number;
}

export class TranslatedLane implements Lane {
  readonly frames = new FrameBus();
  readonly transcripts: TranscriptBus;

  private readonly encoder: LaneOpusEncoder;
  private readonly sink: WebMSink;
  private readonly clock: Clock;
  private readonly stateListeners = new Set<(state: LaneState) => void>();
  private elapsedMs = 0;
  private drops = 0;
  private laneState: LaneState = "starting";
  private closed = false;

  /** Wall-clock time and media clock at construction: the filler's origin. */
  private readonly startedAt: number;
  private readonly startedElapsedMs: number;
  private readonly silenceFrame = Buffer.alloc(frameBytesFor(24000));
  /**
   * True while silence is being written at wall-clock rate: from birth until
   * the session first speaks, and again from FILL_AFTER_MS into any later gap
   * until it speaks again. Sticky on purpose — once a gap has been judged
   * real, the timeline is kept up every tick, not in FILL_AFTER_MS steps that
   * would have every phone run dry between them.
   */
  private filling = true;
  private fillTimer: TimerHandle | undefined;

  private constructor(
    readonly lang: LangCode,
    private readonly session: TranslateSession,
    opts: TranslatedLaneOptions,
  ) {
    // Gemini returns 24 kHz audio, so this lane encodes at 24 kHz.
    this.encoder = new LaneOpusEncoder(24000, opts.opusBitrate);
    this.sink = new WebMSink({ inputSampleRate: 24000, backlogMs: opts.streamPrimeMs ?? 0 });
    this.clock = opts.clock;
    this.transcripts = new TranscriptBus(opts.clock, opts.historyLines);
    this.frames.subscribe((frame) => this.sink.writeOpus(frame));
    this.elapsedMs = primeSilence(this.encoder, this.frames, opts.streamPrimeMs ?? 0, this.elapsedMs);
    this.startedAt = opts.clock.now();
    this.startedElapsedMs = this.elapsedMs;

    session.on("audio", (pcm24k) => {
      this.filling = false;
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

    this.scheduleFill();
  }

  /**
   * Keeps this lane's stream continuous in real time even when the session
   * has nothing to say.
   *
   * The model sends no audio at all until it first speaks — about a second
   * after the first utterance begins — and from then on a continuous stream
   * at exactly real time, silence included (measured 2026-09-11 over 76 s,
   * 45 of them silent). The attendee's player is built for that continuous
   * stream and reads any gap in it as a network stall: it holds the playhead
   * 0.6 s behind the newest audio, so a cold lane's silence prime drained in
   * 0.6 s and the app showed "Reconnecting audio" until the speaker's first
   * sentence had been translated, on a connection that had not stalled. A
   * plain `<audio>` fires `stalled` on the same gap. So until the session has
   * spoken, silence is written at wall-clock rate, and after that a gap of
   * more than FILL_AFTER_MS is covered the same way (a dead connection, while
   * SessionRotator replaces it). The session's own audio always appends
   * where the timeline stands, so nothing it sends is delayed or dropped.
   *
   * Driven by the lane's `Clock` rather than by ingest frames on purpose:
   * the stream has to stay continuous for the phones even while the
   * operator's capture is down, or every one of them would report a stall
   * that is really the speaker's laptop rebooting.
   */
  private scheduleFill(): void {
    this.fillTimer = this.clock.setTimeout(() => {
      this.fillTimer = undefined;
      if (this.closed) return;
      this.fillToWallClock();
      this.scheduleFill();
    }, FILL_TICK_MS);
  }

  private fillToWallClock(): void {
    const target = this.startedElapsedMs + (this.clock.now() - this.startedAt);
    const deficit = target - this.elapsedMs;
    if (!this.filling && deficit < FILL_AFTER_MS) return;
    this.filling = true;
    for (let filled = 0; filled + FRAME_MS <= deficit; filled += FRAME_MS) {
      this.elapsedMs = pumpPackets(this.encoder, this.frames, this.silenceFrame, this.elapsedMs);
    }
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

  get backlog(): Buffer {
    return this.sink.backlog;
  }

  get mediaMs(): number {
    return this.elapsedMs;
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
    // Before the encoder goes: a tick that fired after close() would encode
    // silence on a disposed encoder, which throws.
    if (this.fillTimer) {
      this.clock.clearTimeout(this.fillTimer);
      this.fillTimer = undefined;
    }
    this.setState("error");
    this.session.close();
    this.encoder.close();
  }
}
