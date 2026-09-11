import { describe, expect, test } from "vitest";
import { AppLog, MAX_APP_LOG_LINES } from "./app-log.ts";

describe("AppLog", () => {
  test("starts empty and appends newest last with the level and time", () => {
    let now = 1_000;
    const log = new AppLog(() => now);
    expect(log.getSnapshot()).toEqual([]);

    log.info("capture started");
    now = 2_000;
    log.error("device open failed");
    expect(log.getSnapshot()).toEqual([
      { level: "info", text: "capture started", at: 1_000 },
      { level: "error", text: "device open failed", at: 2_000 },
    ]);
  });

  test("hands subscribers a new array on every line, so useSyncExternalStore re-renders", () => {
    const log = new AppLog(() => 0);
    const seen: unknown[] = [];
    const before = log.getSnapshot();
    log.subscribe(() => seen.push(log.getSnapshot()));
    log.info("a");
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(before);
    expect(log.getSnapshot()).toBe(seen[0]);
  });

  test("is bounded: a long event cannot grow it without limit", () => {
    const log = new AppLog(() => 0);
    for (let i = 0; i < MAX_APP_LOG_LINES + 25; i++) log.info(`line ${i}`);
    const lines = log.getSnapshot();
    expect(lines).toHaveLength(MAX_APP_LOG_LINES);
    expect(lines[0]!.text).toBe("line 25");
    expect(lines.at(-1)!.text).toBe(`line ${MAX_APP_LOG_LINES + 24}`);
  });

  test("a subscriber that throws does not stop the others", () => {
    const log = new AppLog(() => 0);
    let reached = false;
    log.subscribe(() => {
      throw new Error("boom");
    });
    log.subscribe(() => {
      reached = true;
    });
    log.info("x");
    expect(reached).toBe(true);
  });
});
