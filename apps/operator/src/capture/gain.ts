/**
 * The slider's range. ±24 dB is a factor of sixteen either way: enough to
 * rescue a send that arrives at -40 dBFS or to tame one that arrives hot,
 * and not so much that a knocked slider turns room tone into full scale.
 */
export const MIN_GAIN_DB = -24;
export const MAX_GAIN_DB = 24;

/** The amplitude factor a GainNode wants for a decibel figure the engineer reads. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/**
 * A stored or typed gain, pinned into the slider's range. Clamped rather than
 * reset like a port: a gain is a device-shaped value the engineer arrived at
 * by ear, and a build that widens or narrows the range should keep as much of
 * that as it can rather than silently returning to unity.
 */
export function clampGainDb(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, value));
}
