import { describe, expect, test } from "vitest";
import { floatTo16BitPcm } from "./pcm.ts";

describe("floatTo16BitPcm", () => {
  test("maps silence to zero", () => {
    expect([...floatTo16BitPcm(new Float32Array([0, 0, 0]))]).toEqual([0, 0, 0]);
  });

  test("maps full scale to the asymmetric i16 endpoints", () => {
    // -1 has an exact representation at -32768; +1 does not, and must not wrap.
    expect([...floatTo16BitPcm(new Float32Array([-1, 1]))]).toEqual([-32768, 32767]);
  });

  test("clamps values outside [-1, 1] instead of wrapping", () => {
    expect([...floatTo16BitPcm(new Float32Array([-4, 4, -1.0001, 1.0001]))]).toEqual([
      -32768, 32767, -32768, 32767,
    ]);
  });

  test("truncates toward zero at half scale", () => {
    // 0.5 * 32767 = 16383.5 → 16383; -0.5 * 32768 = -16384 exactly.
    expect([...floatTo16BitPcm(new Float32Array([0.5, -0.5]))]).toEqual([16383, -16384]);
  });

  test("preserves length and yields a fresh Int16Array", () => {
    const input = new Float32Array(320);
    const out = floatTo16BitPcm(input);
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(320);
    expect(out.buffer).not.toBe(input.buffer);
  });

  test("round-trips a sine within one quantisation step", () => {
    const input = new Float32Array(1000);
    for (let i = 0; i < input.length; i++) input[i] = 0.8 * Math.sin(i / 7);
    const out = floatTo16BitPcm(input);
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(out[i]! / 32767 - input[i]!)).toBeLessThan(1 / 32767);
    }
  });

  test("NaN becomes silence rather than an undefined sample", () => {
    expect([...floatTo16BitPcm(new Float32Array([Number.NaN]))]).toEqual([0]);
  });
});
