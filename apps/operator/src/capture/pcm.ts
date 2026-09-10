/**
 * Convert Web Audio's Float32 samples in [-1, 1] to signed 16-bit PCM.
 *
 * The scale is deliberately asymmetric: i16 spans -32768..32767, so -1 maps to
 * -32768 exactly while +1 maps to 32767. Using 32768 for both wraps +1 round to
 * -32768 and produces a full-scale click on every peak.
 */
export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = input[i]!;
    // A NaN sample from a glitching driver must become silence, not garbage.
    const finite = Number.isNaN(sample) ? 0 : sample;
    const clamped = finite < -1 ? -1 : finite > 1 ? 1 : finite;
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}
