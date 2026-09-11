import { describe, expect, test } from "vitest";
import { Fft } from "./fft.ts";
import {
  BINS,
  FRAME,
  HOP,
  LATENCY_SAMPLES,
  MAX_SENSITIVITY_DB,
  MIN_SENSITIVITY_DB,
  NoiseProfiler,
  NoiseReducer,
  clampSensitivityDb,
  normalizeNoiseProfile,
  type NoiseProfile,
} from "./noise-reducer.ts";

/** A deterministic pseudo-random generator so a failing test repeats. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000 - 0.5;
  };
}

function blocks(samples: Float32Array): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i + HOP <= samples.length; i += HOP) out.push(samples.subarray(i, i + HOP));
  return out;
}

function run(reducer: NoiseReducer, input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  let at = 0;
  for (const block of blocks(input)) {
    out.set(reducer.process(block), at);
    at += HOP;
  }
  return out;
}

function flatProfile(db: number, gainDb = 0): NoiseProfile {
  return { bins: Array.from({ length: BINS }, () => db), gainDb, levelDb: db };
}

function rms(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (to - from));
}

function toDb(amplitude: number): number {
  return 20 * Math.log10(amplitude);
}

/** Energy at one frequency in a stretch of signal, in dB, via a Hann-windowed DFT. */
function binDb(samples: Float32Array, bin: number, from: number): number {
  const fft = new Fft(FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    re[i] = samples[from + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));
  }
  fft.forward(re, im);
  return toDb(Math.hypot(re[bin]!, im[bin]!) / FRAME + 1e-12);
}

const SECONDS = 16000;

describe("NoiseReducer", () => {
  test("passes a signal above the profile through intact, one frame minus a hop late", () => {
    const rand = lcg(1);
    const input = new Float32Array(SECONDS);
    for (let i = 0; i < input.length; i++) input[i] = rand() * 0.5;

    const reducer = new NoiseReducer();
    reducer.setProfile(flatProfile(-200), 0);
    const output = run(reducer, input);

    // After the overlap-add has warmed up, every output sample is the input
    // sample from LATENCY_SAMPLES earlier — the STFT round trip is exact.
    for (let i = FRAME * 2; i < input.length; i++) {
      expect(output[i]).toBeCloseTo(input[i - LATENCY_SAMPLES]!, 5);
    }
    expect(LATENCY_SAMPLES).toBe(FRAME - HOP);
  });

  test("takes a signal below the profile down by tens of dB", () => {
    const rand = lcg(2);
    const input = new Float32Array(SECONDS);
    for (let i = 0; i < input.length; i++) input[i] = rand() * 0.5;

    const reducer = new NoiseReducer();
    reducer.setProfile(flatProfile(200), 0);
    const output = run(reducer, input);

    // Past the release: a bin closes over ~60 ms, and all the way to the
    // floor over a few hundred, so the first half second still carries the
    // tail of the open gain every bin started with.
    const from = SECONDS / 2;
    expect(toDb(rms(output, from)) - toDb(rms(input, from))).toBeLessThan(-35);
  });

  test("keeps the speaker's tone while removing the noise it was measured against", () => {
    const rand = lcg(3);
    const noise = () => rand() * 0.02; // about -40 dBFS of hiss
    const tone = (i: number) => 0.3 * Math.sin((2 * Math.PI * 40 * i) / FRAME); // bin 40

    // The room, measured with the speaker quiet.
    const profiler = new NoiseProfiler(HOP * 250);
    const quiet = new Float32Array(HOP * 250);
    for (let i = 0; i < quiet.length; i++) quiet[i] = noise();
    for (const block of blocks(quiet)) profiler.push(block);
    expect(profiler.done).toBe(true);
    const profile = profiler.profile(0);
    expect(profile.levelDb).toBeGreaterThan(-50);
    expect(profile.levelDb).toBeLessThan(-38);

    const reducer = new NoiseReducer();
    reducer.setProfile(profile, 0);
    reducer.setSensitivityDb(6);

    const input = new Float32Array(SECONDS);
    for (let i = 0; i < input.length; i++) input[i] = tone(i) + noise();
    const output = run(reducer, input);

    const at = FRAME * 8;
    // The tone's bin survives within a dB...
    expect(binDb(output, 40, at)).toBeGreaterThan(binDb(input, 40, at - LATENCY_SAMPLES) - 1);
    // ...while a bin the speaker never uses drops by well over 20 dB.
    expect(binDb(output, 150, at)).toBeLessThan(binDb(input, 150, at - LATENCY_SAMPLES) - 20);
    expect(reducer.reductionDb).toBeGreaterThan(0);
  });

  test("a louder sensitivity removes more, and the trim shifts the profile with the signal", () => {
    const rand = lcg(4);
    const input = new Float32Array(SECONDS);
    for (let i = 0; i < input.length; i++) input[i] = rand() * 0.02;

    // Profile taken exactly at the noise's level: at 0 dB sensitivity roughly
    // half the bins sit under the line, at +24 dB all of them do.
    const profiler = new NoiseProfiler(HOP * 250);
    for (const block of blocks(input.subarray(0, HOP * 250))) profiler.push(block);
    const profile = profiler.profile(0);

    const lenient = new NoiseReducer();
    lenient.setProfile(profile, 0);
    lenient.setSensitivityDb(-12);
    const strict = new NoiseReducer();
    strict.setProfile(profile, 0);
    strict.setSensitivityDb(24);

    const from = SECONDS / 2;
    const lenientDrop = toDb(rms(run(lenient, input), from)) - toDb(rms(input, from));
    const strictDrop = toDb(rms(run(strict, input), from)) - toDb(rms(input, from));
    expect(lenientDrop).toBeGreaterThan(-6);
    expect(strictDrop).toBeLessThan(-30);

    // The engineer turns the trim up 20 dB after measuring: the same room
    // now arrives 20 dB hotter. Told about the trim, the reducer lifts the
    // profile with it and still removes the room; not told, it would read
    // the room as 20 dB above the line and let it all through.
    const hotter = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) hotter[i] = input[i]! * 10;
    const tracking = new NoiseReducer();
    tracking.setProfile(profile, 20);
    tracking.setSensitivityDb(6);
    expect(toDb(rms(run(tracking, hotter), from)) - toDb(rms(hotter, from))).toBeLessThan(-15);

    const stale = new NoiseReducer();
    stale.setProfile(profile, 0);
    stale.setSensitivityDb(6);
    expect(toDb(rms(run(stale, hotter), from)) - toDb(rms(hotter, from))).toBeGreaterThan(-3);
  });

  test("reset() forgets buffered audio so a re-enable does not replay it", () => {
    const reducer = new NoiseReducer();
    reducer.setProfile(flatProfile(-200), 0);
    const loud = new Float32Array(HOP * 8).fill(0.5);
    run(reducer, loud);
    reducer.reset();
    const silence = new Float32Array(HOP * 8);
    const output = run(reducer, silence);
    expect(rms(output)).toBe(0);
  });
});

describe("NoiseProfiler", () => {
  test("is done after the requested duration and not before", () => {
    const profiler = new NoiseProfiler(HOP * 10);
    const block = new Float32Array(HOP);
    for (let i = 0; i < 9; i++) {
      profiler.push(block);
      expect(profiler.done).toBe(false);
    }
    profiler.push(block);
    expect(profiler.done).toBe(true);
  });

  test("sits near the top of what it heard, so one cough does not set the room's level", () => {
    const rand = lcg(5);
    const profiler = new NoiseProfiler(HOP * 250);
    for (let b = 0; b < 250; b++) {
      const block = new Float32Array(HOP);
      // Two blocks of a very loud transient in an otherwise steady hiss.
      const scale = b === 100 || b === 101 ? 1 : 0.02;
      for (let i = 0; i < HOP; i++) block[i] = rand() * scale;
      profiler.push(block);
    }
    const profile = profiler.profile(3);
    expect(profile.gainDb).toBe(3);
    expect(profile.bins).toHaveLength(BINS);
    expect(profile.levelDb).toBeLessThan(-38);
    expect(profile.levelDb).toBeGreaterThan(-50);
  });
});

describe("normalizeNoiseProfile", () => {
  test("accepts a stored profile of the right shape", () => {
    const profile = flatProfile(-50, 2);
    expect(normalizeNoiseProfile(profile)).toEqual(profile);
  });

  test.each([
    null,
    undefined,
    "x",
    { bins: [1, 2], gainDb: 0, levelDb: -50 },
    { bins: Array.from({ length: BINS }, () => "a"), gainDb: 0, levelDb: -50 },
    { bins: Array.from({ length: BINS }, () => NaN), gainDb: 0, levelDb: -50 },
    { bins: Array.from({ length: BINS }, () => -50), gainDb: "0", levelDb: -50 },
  ])("rejects %j", (value) => {
    expect(normalizeNoiseProfile(value)).toBeNull();
  });
});

describe("clampSensitivityDb", () => {
  test("pins into range and defaults non-numbers", () => {
    expect(clampSensitivityDb(undefined)).toBe(6);
    expect(clampSensitivityDb(NaN)).toBe(6);
    expect(clampSensitivityDb(-100)).toBe(MIN_SENSITIVITY_DB);
    expect(clampSensitivityDb(100)).toBe(MAX_SENSITIVITY_DB);
    expect(clampSensitivityDb(3)).toBe(3);
  });
});
