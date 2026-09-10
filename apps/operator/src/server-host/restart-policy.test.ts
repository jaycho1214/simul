import { describe, expect, test } from "vitest";
import {
  GIVE_UP_AFTER,
  GIVE_UP_WINDOW_MS,
  restartDelayMs,
  shouldGiveUp,
} from "./restart-policy.ts";

describe("restartDelayMs", () => {
  test("restarts the first crash almost immediately", () => {
    expect(restartDelayMs(0)).toBe(500);
  });

  test("doubles up to an 8 s ceiling", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(restartDelayMs)).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });
});

describe("shouldGiveUp", () => {
  test("tolerates crashes below the threshold", () => {
    const failures = [0, 1000, 2000, 3000];
    expect(failures).toHaveLength(GIVE_UP_AFTER - 1);
    expect(shouldGiveUp(failures, 4000)).toBe(false);
  });

  test("gives up once the threshold is reached inside the window", () => {
    expect(shouldGiveUp([0, 1000, 2000, 3000, 4000], 5000)).toBe(true);
  });

  test("ignores crashes that fell out of the window", () => {
    const old = 0;
    const recent = [GIVE_UP_WINDOW_MS + 1, GIVE_UP_WINDOW_MS + 2, GIVE_UP_WINDOW_MS + 3];
    expect(shouldGiveUp([old, ...recent], GIVE_UP_WINDOW_MS + 10)).toBe(false);
  });

  test("a long-running server that crashes once does not trip the limit", () => {
    const hourly = [0, 3_600_000, 7_200_000, 10_800_000, 14_400_000];
    expect(shouldGiveUp(hourly, 14_400_001)).toBe(false);
  });
});
