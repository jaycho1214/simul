import { describe, expect, test } from "vitest";
import { estimateUsd, formatUsd, sumUsage } from "./usage-cost.ts";

describe("estimateUsd", () => {
  // The pricing page's own worked example: one minute of translation at 25
  // tokens per second is 1,500 tokens each way — $0.00525 in, $0.0315 out.
  test("prices a minute of one lane at the published per-token rates", () => {
    expect(estimateUsd({ inputAudioTokens: 1500, outputAudioTokens: 1500 })).toBeCloseTo(
      0.03675,
      6,
    );
  });

  test("nothing used costs nothing", () => {
    expect(estimateUsd({ inputAudioTokens: 0, outputAudioTokens: 0 })).toBe(0);
  });
});

describe("sumUsage", () => {
  test("adds every language into one total", () => {
    expect(
      sumUsage([
        { lang: "en", inputAudioTokens: 100, outputAudioTokens: 10 },
        { lang: "ja", inputAudioTokens: 50, outputAudioTokens: 5 },
      ]),
    ).toEqual({ inputAudioTokens: 150, outputAudioTokens: 15 });
  });
});

describe("formatUsd", () => {
  test("shows cents while the figure is small and dollars once it is not", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.03675)).toBe("$0.04");
    expect(formatUsd(0.004)).toBe("$0.00");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(1234.567)).toBe("$1,234.57");
  });
});
