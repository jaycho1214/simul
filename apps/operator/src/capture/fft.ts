/**
 * An in-place radix-2 complex FFT, sized once and reused for every frame.
 *
 * Hand-rolled rather than a dependency because the noise reducer needs
 * exactly one transform size, forwards and back, a hundred-odd times a
 * second — small enough that the textbook iterative butterfly is plenty, and
 * small enough to be read in full and tested against the naive DFT.
 */
export class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.reverse = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reverse[i] = r;
    }
  }

  /** X[k] = Σ x[n]·e^(−2πikn/N), computed in place. */
  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, false);
  }

  /** The inverse, scaled by 1/N so inverse(forward(x)) = x. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, true);
    const n = this.size;
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }

  private transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = (inverse ? 1 : -1) * this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}
