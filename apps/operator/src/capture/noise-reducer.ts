import { Fft } from "./fft.ts";
import { DB_FLOOR, toDb } from "./level.ts";

/**
 * A spectral gate: the room's background, measured once while the speaker is
 * quiet, is subtracted from the feed — per frequency, not per moment.
 *
 * A plain gate mutes whole blocks that are quieter than a line, which is the
 * wrong tool for a microphone that also hears the audience or the interpreter
 * beside the speaker: as soon as the speaker talks the block is loud, the
 * gate opens, and everything under the voice comes through with it. Working
 * on a 512-point spectrum instead, each frequency bin is compared against
 * what the room measured *in that bin*; a bin the speaker is using stays,
 * every bin sitting at the room's level goes. Background under the voice is
 * therefore reduced wherever the two do not overlap in frequency, and
 * between sentences everything goes. It is not source separation: a second
 * voice that is nearly as loud as the speaker, in the same bands at the same
 * moment, cannot be told apart by level alone, and nothing single-channel
 * can. What it does do is keep quieter voices, and the room between
 * sentences, from being handed to the model as speech.
 *
 * Latency is one frame minus one hop — 384 samples, 24 ms at 16 kHz — with
 * no lookahead beyond that; the decision for each block is made as soon as
 * the frame it completes can be transformed.
 *
 * Runs in the renderer's main thread on the same 128-sample blocks the
 * worklet already posts, like every other piece of arithmetic in the capture
 * chain; the worklet stays a copy loop with nothing in it to test.
 */
export const FRAME = 512;
export const HOP = 128;
export const BINS = FRAME / 2 + 1;
export const LATENCY_SAMPLES = FRAME - HOP;

/**
 * How far above the measured room a sound must be to survive. Positive keeps
 * a margin above the room's own fluctuation; negative lets more through for
 * a speaker who is barely louder than the background.
 */
export const MIN_SENSITIVITY_DB = -12;
export const MAX_SENSITIVITY_DB = 24;
export const DEFAULT_SENSITIVITY_DB = 6;

/** How far a bin under the line is taken down. Not silence: a hard floor
 *  clicks and warbles where a deep, fixed cut merely disappears. */
const REDUCTION_DB = 40;
/** The cut fades in over this many dB below the line, so a speech component
 *  hovering at the threshold is not chopped on and off between frames. */
const KNEE_DB = 6;
/** A bin opens the instant it is needed — onsets are what the model keys on —
 *  and closes over about 60 ms, so a word's tail is not clipped. */
const RELEASE_ALPHA = Math.exp(-HOP / (0.06 * 16000));
/** The room is what it sounds like most of the time, not at its loudest
 *  instant: this high in the measured distribution a cough or a dropped
 *  pen does not set the line, and steady chatter still does. */
const PROFILE_PERCENTILE = 0.9;
const EPS = 1e-12;

/** What the room sounded like, per bin, in dB of windowed magnitude. */
export interface NoiseProfile {
  /** BINS entries, the level in each frequency bin. */
  bins: number[];
  /**
   * The input trim at the moment of measurement. The profile describes the
   * signal *after* the trim, so if the trim moves later the profile is
   * shifted by the difference before it is applied — the room did not get
   * louder because the engineer turned the feed up.
   */
  gainDb: number;
  /** The room's broadband level, dBFS, as the panel shows it. */
  levelDb: number;
}

/**
 * Square-root Hann, periodic, applied on the way in and again on the way
 * out: the two together make one Hann, which at a quarter-frame hop sums to
 * a constant across the overlap, so the round trip with no reduction is
 * the input exactly.
 */
const WINDOW = new Float64Array(FRAME);
for (let i = 0; i < FRAME; i++)
  WINDOW[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));

/** Σ over hops of analysis × synthesis window — 2.0 for this pair. */
const OVERLAP_GAIN = (() => {
  let sum = 0;
  for (let k = 0; k < FRAME / HOP; k++) sum += WINDOW[k * HOP]! * WINDOW[k * HOP]!;
  return sum;
})();

/** Windowed magnitude of each bin, in dB, of the frame ending in `buf`. */
function analyze(fft: Fft, buf: Float32Array, re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < FRAME; i++) {
    re[i] = buf[i]! * WINDOW[i]!;
    im[i] = 0;
  }
  fft.forward(re, im);
}

function magnitudeDb(re: number, im: number): number {
  return toDb(Math.sqrt(re * re + im * im) / FRAME + EPS);
}

export class NoiseReducer {
  private readonly fft = new Fft(FRAME);
  private readonly inBuf = new Float32Array(FRAME);
  private readonly outBuf = new Float64Array(FRAME);
  private readonly re = new Float64Array(FRAME);
  private readonly im = new Float64Array(FRAME);
  private readonly target = new Float64Array(BINS);
  private readonly smoothed = new Float64Array(BINS);
  private readonly gain = new Float64Array(BINS).fill(1);
  /** Reused across calls: the caller consumes it before the next process(). */
  private readonly out = new Float32Array(HOP);

  private profile: NoiseProfile | null = null;
  private trimDb = 0;
  private sensitivityDb = DEFAULT_SENSITIVITY_DB;
  private thresholds: Float64Array | undefined;

  /**
   * How much the last frame was taken down overall, in dB: near zero while
   * the speaker fills the spectrum, up to REDUCTION_DB between sentences.
   * For the meter, so an engineer can see the thing working.
   */
  reductionDb = 0;

  setProfile(profile: NoiseProfile | null, currentTrimDb: number): void {
    this.profile = profile;
    this.trimDb = currentTrimDb;
    this.rebuild();
  }

  setTrimDb(db: number): void {
    this.trimDb = db;
    this.rebuild();
  }

  setSensitivityDb(db: number): void {
    this.sensitivityDb = clampSensitivityDb(db);
    this.rebuild();
  }

  /** Drops buffered audio and open bins — for a re-enable, not a restart. */
  reset(): void {
    this.inBuf.fill(0);
    this.outBuf.fill(0);
    this.gain.fill(1);
    this.reductionDb = 0;
  }

  private rebuild(): void {
    if (!this.profile) {
      this.thresholds = undefined;
      return;
    }
    const shift = this.trimDb - this.profile.gainDb + this.sensitivityDb;
    const thresholds = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) thresholds[k] = this.profile.bins[k]! + shift;
    this.thresholds = thresholds;
  }

  /**
   * One HOP-sized block in, one out, LATENCY_SAMPLES later. The returned
   * array is owned by the reducer and overwritten by the next call.
   */
  process(block: Float32Array): Float32Array {
    const { inBuf, outBuf, re, im } = this;
    inBuf.copyWithin(0, HOP);
    inBuf.set(block, FRAME - HOP);
    analyze(this.fft, inBuf, re, im);

    const thresholds = this.thresholds;
    if (thresholds) {
      const { target, smoothed, gain } = this;
      for (let k = 0; k < BINS; k++) {
        const under = (magnitudeDb(re[k]!, im[k]!) - thresholds[k]!) / KNEE_DB;
        const cutDb = under >= 0 ? 0 : under <= -1 ? -REDUCTION_DB : under * REDUCTION_DB;
        target[k] = 10 ** (cutDb / 20);
      }
      // A little smoothing across neighbouring bins keeps the cut from
      // flickering bin by bin — the "musical noise" of a bare spectral gate.
      for (let k = 0; k < BINS; k++) {
        const lo = target[k > 0 ? k - 1 : k]!;
        const hi = target[k < BINS - 1 ? k + 1 : k]!;
        smoothed[k] = 0.25 * lo + 0.5 * target[k]! + 0.25 * hi;
      }
      let inEnergy = 0;
      let outEnergy = 0;
      for (let k = 0; k < BINS; k++) {
        const wanted = smoothed[k]!;
        const g =
          wanted > gain[k]! ? wanted : RELEASE_ALPHA * gain[k]! + (1 - RELEASE_ALPHA) * wanted;
        gain[k] = g;
        const energy = re[k]! * re[k]! + im[k]! * im[k]!;
        inEnergy += energy;
        outEnergy += energy * g * g;
        re[k] = re[k]! * g;
        im[k] = im[k]! * g;
        if (k > 0 && k < FRAME / 2) {
          re[FRAME - k] = re[FRAME - k]! * g;
          im[FRAME - k] = im[FRAME - k]! * g;
        }
      }
      this.reductionDb = 10 * Math.log10((inEnergy + EPS) / (outEnergy + EPS));
    } else {
      this.reductionDb = 0;
    }

    this.fft.inverse(re, im);
    for (let i = 0; i < FRAME; i++) outBuf[i] = outBuf[i]! + re[i]! * WINDOW[i]!;

    const out = this.out;
    for (let i = 0; i < HOP; i++) out[i] = outBuf[i]! / OVERLAP_GAIN;
    outBuf.copyWithin(0, HOP);
    outBuf.fill(0, FRAME - HOP);
    return out;
  }
}

/**
 * Listens for a fixed stretch of audio — the room with the speaker quiet —
 * and turns it into a NoiseProfile. Blocks after the stretch are ignored, so
 * a caller can keep feeding it and check `done`.
 */
export class NoiseProfiler {
  private readonly fft = new Fft(FRAME);
  private readonly inBuf = new Float32Array(FRAME);
  private readonly re = new Float64Array(FRAME);
  private readonly im = new Float64Array(FRAME);
  private readonly frames: Float32Array[] = [];
  private readonly levels: number[] = [];
  private received = 0;

  constructor(private readonly samples: number) {}

  get done(): boolean {
    return this.received >= this.samples;
  }

  push(block: Float32Array): void {
    if (this.done) return;
    this.received += block.length;
    this.inBuf.copyWithin(0, HOP);
    this.inBuf.set(block, FRAME - HOP);
    // Not before the buffer holds a whole frame of real audio: the zeros it
    // started with would read as a quieter room than there is.
    if (this.received < FRAME) return;

    analyze(this.fft, this.inBuf, this.re, this.im);
    const frame = new Float32Array(BINS);
    for (let k = 0; k < BINS; k++) frame[k] = magnitudeDb(this.re[k]!, this.im[k]!);
    this.frames.push(frame);

    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i]! * block[i]!;
    this.levels.push(toDb(Math.sqrt(sum / block.length)));
  }

  /** `trimDb`: the input trim in force while listening — see NoiseProfile. */
  profile(trimDb: number): NoiseProfile {
    const bins: number[] = [];
    const column = new Float32Array(this.frames.length);
    for (let k = 0; k < BINS; k++) {
      for (let f = 0; f < this.frames.length; f++) column[f] = this.frames[f]![k]!;
      bins.push(percentile(column, PROFILE_PERCENTILE));
    }
    return {
      bins,
      gainDb: trimDb,
      levelDb: this.levels.length
        ? percentile(Float32Array.from(this.levels), PROFILE_PERCENTILE)
        : DB_FLOOR,
    };
  }
}

function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return DB_FLOOR;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
}

export function clampSensitivityDb(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SENSITIVITY_DB;
  return Math.min(MAX_SENSITIVITY_DB, Math.max(MIN_SENSITIVITY_DB, value));
}

/**
 * A stored profile, or null for anything that is not one — a file from a
 * build with a different FRAME, a hand edit, a half-written record. Null
 * means "not measured", which the panel already handles; a wrong-shaped
 * profile applied anyway would silence the feed or do nothing, quietly.
 */
export function normalizeNoiseProfile(value: unknown): NoiseProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const { bins, gainDb, levelDb } = value as Record<string, unknown>;
  if (!Array.isArray(bins) || bins.length !== BINS) return null;
  if (!bins.every((b) => typeof b === "number" && Number.isFinite(b))) return null;
  if (typeof gainDb !== "number" || !Number.isFinite(gainDb)) return null;
  if (typeof levelDb !== "number" || !Number.isFinite(levelDb)) return null;
  return { bins: bins as number[], gainDb, levelDb };
}
