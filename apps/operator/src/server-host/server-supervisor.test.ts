import { describe, expect, test, vi } from "vitest";
import {
  MAX_LOG_LINES,
  ServerSupervisor,
  type ForkedProcess,
  type ForkFn,
} from "./server-supervisor.ts";

/** A stand-in for a utilityProcess's stdout/stderr NodeJS.ReadableStream. */
class FakeStream {
  private readonly handlers: Array<(chunk: Buffer | string) => void> = [];

  on(event: "data", fn: (chunk: Buffer | string) => void): void {
    if (event === "data") this.handlers.push(fn);
  }

  emit(chunk: Buffer | string): void {
    for (const fn of this.handlers) fn(chunk);
  }
}

/**
 * A stand-in for a forked utility process. It is a real object with a real
 * lifecycle — spawn, message, exit — so the tests below drive the supervisor's
 * state machine rather than asserting that a mock was called.
 */
class FakeProcess implements ForkedProcess {
  killed = false;
  readonly received: unknown[] = [];
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  private readonly handlers = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, fn: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
  }

  postMessage(message: unknown): void {
    this.received.push(message);
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}

function harness(overrides: { external?: boolean } = {}) {
  const spawned: FakeProcess[] = [];
  let clock = 0;
  const pending: Array<{ at: number; fn: () => void }> = [];

  const fork: ForkFn = () => {
    const proc = new FakeProcess();
    spawned.push(proc);
    return proc;
  };

  const supervisor = new ServerSupervisor({
    entryPath: "/ignored/server-entry.js",
    // A function, not a value: settings change mid-event and every spawn must
    // read the current environment rather than one captured at construction.
    env: () => ({ PORT: "8080" }),
    external: overrides.external ?? false,
    fork,
    schedule: (fn, ms) => {
      const entry = { at: clock + ms, fn };
      pending.push(entry);
      return () => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    now: () => clock,
  });

  const advance = (ms: number) => {
    clock += ms;
    for (const entry of pending.splice(0).sort((a, b) => a.at - b.at)) {
      if (entry.at <= clock) entry.fn();
      else pending.push(entry);
    }
  };

  return { supervisor, spawned, advance, tick: () => clock };
}

describe("ServerSupervisor", () => {
  test("reports listening once the child announces its port", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();
    expect(supervisor.status.state).toBe("starting");

    spawned[0]!.emit("spawn");
    spawned[0]!.emit("message", { type: "listening", port: 8080 });

    expect(supervisor.status).toMatchObject({ state: "listening", port: 8080, restarts: 0 });
  });

  test("restarts after a crash and counts it", () => {
    const { supervisor, spawned, advance } = harness();
    supervisor.start();
    spawned[0]!.emit("message", { type: "listening", port: 8080 });

    spawned[0]!.emit("exit", 1);
    expect(supervisor.status).toMatchObject({ state: "crashed", port: undefined });

    advance(500);
    expect(spawned).toHaveLength(2);
    expect(supervisor.status.state).toBe("starting");

    spawned[1]!.emit("message", { type: "listening", port: 8080 });
    expect(supervisor.status).toMatchObject({ state: "listening", restarts: 1 });
  });

  test("gives up after five crashes in a minute instead of thrashing", () => {
    const { supervisor, spawned, advance } = harness();
    supervisor.start();

    for (let i = 0; i < 5; i++) {
      spawned[i]!.emit("exit", 1);
      advance(500);
    }

    expect(supervisor.status.state).toBe("giving_up");
    const spawnedCount = spawned.length;
    advance(60_000);
    expect(spawned).toHaveLength(spawnedCount);
  });

  test("restart() clears the give-up state", () => {
    const { supervisor, spawned, advance } = harness();
    supervisor.start();
    for (let i = 0; i < 5; i++) {
      spawned[i]!.emit("exit", 1);
      advance(500);
    }
    expect(supervisor.status.state).toBe("giving_up");

    supervisor.restart();
    expect(supervisor.status.state).toBe("starting");
    spawned.at(-1)!.emit("message", { type: "listening", port: 8080 });
    expect(supervisor.status.state).toBe("listening");
  });

  test("a fatal message from the child surfaces as detail rather than a silent exit", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();
    spawned[0]!.emit("message", { type: "fatal", message: "GEMINI_API_KEY is required" });

    expect(supervisor.status).toMatchObject({
      state: "crashed",
      detail: "GEMINI_API_KEY is required",
    });
  });

  test("stop() asks the child to shut down and does not restart it", async () => {
    const { supervisor, spawned, advance } = harness();
    supervisor.start();
    spawned[0]!.emit("message", { type: "listening", port: 8080 });

    const stopped = supervisor.stop();
    expect(spawned[0]!.received).toEqual([{ type: "shutdown" }]);
    spawned[0]!.emit("exit", 0);
    await stopped;

    expect(supervisor.status.state).toBe("stopped");
    advance(10_000);
    expect(spawned).toHaveLength(1);
  });

  test("--external-server never forks and reports the external state", () => {
    const { supervisor, spawned } = harness({ external: true });
    supervisor.start();

    expect(spawned).toHaveLength(0);
    expect(supervisor.status).toMatchObject({ state: "external", port: 8080 });
  });

  test("status subscribers see each transition", () => {
    const { supervisor, spawned, advance } = harness();
    const seen: string[] = [];
    supervisor.onStatus((status) => seen.push(status.state));

    supervisor.start();
    spawned[0]!.emit("message", { type: "listening", port: 8080 });
    spawned[0]!.emit("exit", 1);
    advance(500);

    expect(seen).toEqual(["starting", "listening", "crashed", "starting"]);
  });

  test("captures a stdout line and tags it by stream", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();

    spawned[0]!.stdout.emit("tongyeok server on :8080\n");

    expect(supervisor.logs).toEqual([
      { stream: "stdout", text: "tongyeok server on :8080", at: 0 },
    ]);
  });

  test("keeps stdout and stderr separate", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();

    spawned[0]!.stdout.emit("normal boot line\n");
    spawned[0]!.stderr.emit("uncaught exception\n");

    expect(supervisor.logs.map((l) => [l.stream, l.text])).toEqual([
      ["stdout", "normal boot line"],
      ["stderr", "uncaught exception"],
    ]);
  });

  test("joins a line split across two chunks", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();

    // A pipe delivers data as it becomes available, not aligned to line
    // boundaries — the second half of a line can arrive in its own "data" event.
    spawned[0]!.stdout.emit("languages: ko, en");
    spawned[0]!.stdout.emit(", ja (source ko)\n");

    expect(supervisor.logs).toEqual([
      { stream: "stdout", text: "languages: ko, en, ja (source ko)", at: 0 },
    ]);
  });

  test("notifies log subscribers as lines arrive", () => {
    const { supervisor, spawned } = harness();
    const seen: number[] = [];
    supervisor.onLog((lines) => seen.push(lines.length));

    supervisor.start();
    spawned[0]!.stdout.emit("one\n");
    spawned[0]!.stdout.emit("two\n");

    expect(seen).toEqual([1, 2]);
  });

  test("bounds the log so a 90-minute event cannot grow it without limit", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();

    for (let i = 0; i < MAX_LOG_LINES + 20; i++) {
      spawned[0]!.stdout.emit(`line ${i}\n`);
    }

    expect(supervisor.logs).toHaveLength(MAX_LOG_LINES);
    // Oldest lines are dropped first; the newest survive at the tail.
    expect(supervisor.logs.at(0)!.text).toBe("line 20");
    expect(supervisor.logs.at(-1)!.text).toBe(`line ${MAX_LOG_LINES + 19}`);
  });

  test("flushes a trailing partial line when the child exits without a final newline", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();

    spawned[0]!.stdout.emit("shutting down");
    spawned[0]!.emit("exit", 0);

    expect(supervisor.logs).toEqual([{ stream: "stdout", text: "shutting down", at: 0 }]);
  });

  test("log history survives a restart; only the in-flight partial line is dropped", () => {
    const { supervisor, spawned, advance } = harness();
    supervisor.start();
    spawned[0]!.stdout.emit("boot 1\n");

    spawned[0]!.emit("exit", 1);
    advance(500);
    spawned[1]!.stdout.emit("boot 2\n");

    expect(supervisor.logs.map((l) => l.text)).toEqual(["boot 1", "boot 2"]);
  });

  test("restart() flushes the outgoing child's trailing partial line before spawning the next", () => {
    const { supervisor, spawned } = harness();
    supervisor.start();
    // No trailing newline: still in flight when restart() replaces this child.
    spawned[0]!.stdout.emit("mid-line at restart time");

    supervisor.restart();

    expect(supervisor.logs.map((l) => l.text)).toEqual(["mid-line at restart time"]);
  });
});
