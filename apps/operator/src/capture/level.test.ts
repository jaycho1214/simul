import { describe, expect, test } from "vitest";
import { measureLevel, toDb } from "./level.ts";

const sine = (n: number, amplitude: number) =>
  Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * i) / 64));

describe("toDb", () => {
  test("full scale is 0 dBFS", () => {
    expect(toDb(1)).toBeCloseTo(0, 6);
  });

  test("half amplitude is about -6 dBFS", () => {
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
  });

  test("silence floors at -100 rather than -Infinity", () => {
    expect(toDb(0)).toBe(-100);
    expect(toDb(-0.0001)).toBe(-100);
    expect(toDb(1e-12)).toBe(-100);
  });
});

describe("measureLevel", () => {
  test("silence reads zero and does not clip", () => {
    const reading = measureLevel(new Float32Array(512));
    expect(reading.rms).toBe(0);
    expect(reading.peak).toBe(0);
    expect(reading.rmsDb).toBe(-100);
    expect(reading.peakDb).toBe(-100);
    expect(reading.clipping).toBe(false);
  });

  test("a full-scale sine has an RMS of 1/sqrt(2)", () => {
    const reading = measureLevel(sine(640, 1));
    expect(reading.rms).toBeCloseTo(Math.SQRT1_2, 3);
    expect(reading.peak).toBeCloseTo(1, 3);
  });

  test("peak follows the largest magnitude regardless of sign", () => {
    const reading = measureLevel(new Float32Array([0.1, -0.9, 0.2]));
    expect(reading.peak).toBeCloseTo(0.9, 6);
  });

  test("clipping trips at or above the threshold", () => {
    expect(measureLevel(new Float32Array([0.98])).clipping).toBe(false);
    expect(measureLevel(new Float32Array([0.99])).clipping).toBe(true);
    expect(measureLevel(new Float32Array([-1])).clipping).toBe(true);
  });

  test("the clipping threshold is configurable", () => {
    expect(measureLevel(new Float32Array([0.9]), 0.8).clipping).toBe(true);
  });

  test("an empty buffer reads as silence rather than NaN", () => {
    const reading = measureLevel(new Float32Array(0));
    expect(reading.rms).toBe(0);
    expect(reading.peak).toBe(0);
    expect(Number.isNaN(reading.rmsDb)).toBe(false);
  });
});
