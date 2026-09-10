/** Anything quieter than this reads as the floor rather than -Infinity. */
export const DB_FLOOR = -100;

export interface LevelReading {
  /** Root mean square amplitude, 0..1. */
  rms: number;
  /** Largest absolute sample, 0..1. */
  peak: number;
  rmsDb: number;
  peakDb: number;
  clipping: boolean;
}

export function toDb(amplitude: number): number {
  if (!(amplitude > 0)) return DB_FLOOR;
  const db = 20 * Math.log10(amplitude);
  return db < DB_FLOOR ? DB_FLOOR : db;
}

/**
 * RMS, peak and a clipping flag for one AnalyserNode time-domain window.
 * The engineer reads these at arm's length, so the dB values are what the UI
 * draws; the linear values are kept for bar widths.
 */
export function measureLevel(samples: Float32Array, clipThreshold = 0.99): LevelReading {
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const value = Number.isNaN(sample) ? 0 : sample;
    sumSquares += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }

  const rms = samples.length === 0 ? 0 : Math.sqrt(sumSquares / samples.length);

  return {
    rms,
    peak,
    rmsDb: toDb(rms),
    peakDb: toDb(peak),
    clipping: peak >= clipThreshold,
  };
}
