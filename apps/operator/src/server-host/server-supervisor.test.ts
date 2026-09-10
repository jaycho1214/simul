import { describe, expect, test, vi } from "vitest";
import { ServerSupervisor, type ForkedProcess, type ForkFn } from "./server-supervisor.ts";

/**
 * A stand-in for a forked utility process. It is a real object with a real
 * lifecycle — spawn, message, exit — so the tests below drive the supervisor's
 * state machine rather than asserting that a mock was called.
 */
class FakeProcess implements ForkedProcess {
  killed = false;
  readonly received: unknown[] = [];
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
});
