import {
  restartDelayMs,
  shouldGiveUp,
  type RestartFailure,
} from "./restart-policy.ts";

/** The part of Electron's UtilityProcess this supervisor uses. */
export interface ForkedProcess {
  on(event: "spawn" | "exit" | "message" | "error", fn: (...args: any[]) => void): void;
  postMessage(message: unknown): void;
  kill(): boolean;
}

export type ForkFn = (
  entryPath: string,
  args: string[],
  env: Record<string, string>,
) => ForkedProcess;

export type ServerHostState =
  | "stopped"
  | "starting"
  | "listening"
  | "crashed"
  | "giving_up"
  | "external";

export interface ServerStatus {
  state: ServerHostState;
  port: number | undefined;
  restarts: number;
  detail: string | undefined;
}

export interface ServerSupervisorOptions {
  entryPath: string;
  /**
   * Read afresh on every spawn. It must be a function, not a captured record:
   * the engineer can paste a new Gemini API key into settings mid-event, and a
   * subsequent restart has to fork with the new key rather than the one that
   * existed when the app booted.
   */
  env: () => Record<string, string>;
  /** --external-server: assume a server is already running, do not fork. */
  external: boolean;
  fork: ForkFn;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

/** Messages the forked server entry sends back. */
type ChildMessage =
  | { type: "listening"; port: number }
  | { type: "fatal"; message: string };

export class ServerSupervisor {
  private readonly opts: Required<ServerSupervisorOptions>;
  private readonly listeners = new Set<(status: ServerStatus) => void>();
  private readonly failures: RestartFailure[] = [];

  private child: ForkedProcess | undefined;
  private cancelRestart: (() => void) | undefined;
  private stopping: (() => void) | undefined;
  private current: ServerStatus = {
    state: "stopped",
    port: undefined,
    restarts: 0,
    detail: undefined,
  };

  constructor(options: ServerSupervisorOptions) {
    this.opts = {
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
      now: () => Date.now(),
      ...options,
    };
  }

  get status(): ServerStatus {
    return this.current;
  }

  onStatus(fn: (status: ServerStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<ServerStatus>): void {
    this.current = { ...this.current, ...patch };
    for (const fn of this.listeners) {
      try {
        fn(this.current);
      } catch (err) {
        console.error("server status listener threw", err);
      }
    }
  }

  start(): void {
    if (this.opts.external) {
      // The engineer is running the server standalone in another terminal.
      // Report the port from the environment and fork nothing.
      const port = Number(this.opts.env().PORT ?? 8080);
      this.set({ state: "external", port, detail: undefined });
      return;
    }
    if (this.child) return;
    this.spawn();
  }

  restart(): void {
    this.cancelRestart?.();
    this.cancelRestart = undefined;
    this.failures.length = 0;
    // Clear `this.child` before kill(), not after: the exit handler's
    // `this.child !== child` guard is what tells a deliberate restart apart
    // from an unexpected crash. Killing first and clearing second would let
    // a same-tick exit (real Electron's kill() is async, but a test double
    // or a future platform quirk might not be) still match `this.child`,
    // get logged as a crash, and schedule a redundant second restart on top
    // of the spawn() below.
    const child = this.child;
    this.child = undefined;
    child?.kill();
    this.spawn();
  }

  async stop(): Promise<void> {
    this.cancelRestart?.();
    this.cancelRestart = undefined;

    const child = this.child;
    if (!child) {
      this.set({ state: "stopped", port: undefined });
      return;
    }

    await new Promise<void>((resolve) => {
      this.stopping = resolve;
      // Ask nicely first so the HTTP server closes its sockets, then insist.
      child.postMessage({ type: "shutdown" });
      const force = this.opts.schedule(() => {
        child.kill();
      }, 3000);
      this.stopping = () => {
        force();
        resolve();
      };
    });

    this.child = undefined;
    this.set({ state: "stopped", port: undefined });
  }

  private spawn(): void {
    this.set({ state: "starting", port: undefined, detail: undefined });

    let child: ForkedProcess;
    try {
      child = this.opts.fork(this.opts.entryPath, [], this.opts.env());
    } catch (err) {
      this.onExit(String((err as Error).message ?? err));
      return;
    }
    this.child = child;

    child.on("message", (message: ChildMessage) => {
      if (this.child !== child) return;
      if (message?.type === "listening") {
        this.set({ state: "listening", port: message.port, detail: undefined });
      } else if (message?.type === "fatal") {
        this.set({ state: "crashed", port: undefined, detail: message.message });
      }
    });

    child.on("error", (type: string, location: string) => {
      if (this.child !== child) return;
      this.set({ detail: `${type} at ${location}` });
    });

    child.on("exit", (code: number) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.stopping) {
        const resolve = this.stopping;
        this.stopping = undefined;
        resolve();
        return;
      }
      this.onExit(this.current.detail ?? `exit code ${code}`);
    });
  }

  private onExit(detail: string): void {
    const now = this.opts.now();
    this.failures.push(now);
    this.set({
      state: "crashed",
      port: undefined,
      restarts: this.current.restarts + 1,
      detail,
    });

    if (shouldGiveUp(this.failures, now)) {
      this.set({ state: "giving_up" });
      return;
    }

    // Every automatic restart uses the ladder's first rung (500 ms): a fast,
    // predictable recovery for the common case (one bad frame, a transient
    // bind race). What actually keeps a broken server from spinning forever
    // is GIVE_UP_AFTER, not an escalating delay — five crashes inside
    // GIVE_UP_WINDOW_MS stops the loop outright and asks the engineer to
    // read `detail` and press restart. restartDelayMs's higher rungs remain
    // exported and unit-tested for a future policy that escalates within a
    // single give-up window; wiring escalation into this call is exactly
    // what breaks that bound — the second rung alone (1000 ms) already
    // exceeds the 500 ms cadence a human notices between retries here.
    this.cancelRestart = this.opts.schedule(() => {
      this.cancelRestart = undefined;
      this.spawn();
    }, restartDelayMs(0));
  }
}

/** The real fork, used by main.ts. Imported lazily so tests never load Electron. */
export function electronForkFn(): ForkFn {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { utilityProcess } = require("electron") as typeof import("electron");
  return (entryPath, args, env) =>
    utilityProcess.fork(entryPath, args, {
      env,
      serviceName: "tongyeok-server",
      // Inherit so the server's console output lands in the operator app's
      // terminal during development instead of disappearing.
      stdio: "inherit",
    }) as unknown as ForkedProcess;
}
