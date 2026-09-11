import { describe, expect, test } from "vitest";
import { MAX_GAIN_DB, MIN_GAIN_DB, clampGainDb, dbToLinear } from "./gain.ts";

describe("dbToLinear", () => {
  test("0 dB is unity", () => {
    expect(dbToLinear(0)).toBe(1);
  });

  test("+6 dB roughly doubles and -6 dB roughly halves", () => {
    expect(dbToLinear(6)).toBeCloseTo(1.9953, 3);
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3);
  });

  test("+20 dB is exactly ten times", () => {
    expect(dbToLinear(20)).toBeCloseTo(10, 9);
  });
});

describe("clampGainDb", () => {
  test("keeps a value inside the slider's range", () => {
    expect(clampGainDb(0)).toBe(0);
    expect(clampGainDb(-12)).toBe(-12);
    expect(clampGainDb(MAX_GAIN_DB)).toBe(MAX_GAIN_DB);
  });

  test("pins anything beyond the range to its edge rather than resetting it", () => {
    expect(clampGainDb(MAX_GAIN_DB + 30)).toBe(MAX_GAIN_DB);
    expect(clampGainDb(MIN_GAIN_DB - 30)).toBe(MIN_GAIN_DB);
  });

  test("reads anything that is not a finite number as 0 dB", () => {
    expect(clampGainDb(Number.NaN)).toBe(0);
    expect(clampGainDb(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampGainDb("6" as unknown as number)).toBe(0);
  });
});
