import { afterEach, describe, expect, test, vi } from "vitest";
import { DelayQueue } from "./delay-queue.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("DelayQueue", () => {
  test("a zero delay emits synchronously", () => {
    const got: string[] = [];
    const queue = new DelayQueue<string>(0, (item) => got.push(item));

    queue.push("now");

    expect(got).toEqual(["now"]);
    expect(queue.pendingCount).toBe(0);
  });

  test("a positive delay emits nothing before the deadline", () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const queue = new DelayQueue<string>(1500, (item) => got.push(item));

    queue.push("later");
    vi.advanceTimersByTime(1499);
    expect(got).toEqual([]);
    expect(queue.pendingCount).toBe(1);

    vi.advanceTimersByTime(1);
    expect(got).toEqual(["later"]);
    expect(queue.pendingCount).toBe(0);
  });

  test("items are released in push order", () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const queue = new DelayQueue<string>(1000, (item) => got.push(item));

    queue.push("a");
    vi.advanceTimersByTime(200);
    queue.push("b");
    vi.advanceTimersByTime(200);
    queue.push("c");

    vi.advanceTimersByTime(2000);
    expect(got).toEqual(["a", "b", "c"]);
  });

  test("clear cancels everything pending", () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const queue = new DelayQueue<string>(1000, (item) => got.push(item));

    queue.push("dropped");
    queue.clear();
    vi.advanceTimersByTime(5000);

    expect(got).toEqual([]);
    expect(queue.pendingCount).toBe(0);
  });
});
