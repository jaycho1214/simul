import { describe, expect, test } from "vitest";
import { Fft } from "./fft.ts";

function naiveDft(x: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  const re: number[] = [];
  const im: number[] = [];
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      sr += x[t]! * Math.cos(angle);
      si += x[t]! * Math.sin(angle);
    }
    re.push(sr);
    im.push(si);
  }
  return { re, im };
}

describe("Fft", () => {
  test("matches the naive DFT", () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7));
    const expected = naiveDft(x);

    const fft = new Fft(n);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft.forward(re, im);

    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(expected.re[k]!, 9);
      expect(im[k]).toBeCloseTo(expected.im[k]!, 9);
    }
  });

  test("inverse(forward(x)) is x", () => {
    const n = 512;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.05) * Math.cos(i * 0.41));
    const fft = new Fft(n);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft.forward(re, im);
    fft.inverse(re, im);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(x[i]!, 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });

  test("puts a pure tone's energy in its own bin", () => {
    const n = 256;
    const bin = 17;
    const fft = new Fft(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
    fft.forward(re, im);
    expect(Math.hypot(re[bin]!, im[bin]!)).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[bin + 1]!, im[bin + 1]!)).toBeCloseTo(0, 6);
  });

  test("rejects a size that is not a power of two", () => {
    expect(() => new Fft(100)).toThrow(/power of two/);
  });
});
