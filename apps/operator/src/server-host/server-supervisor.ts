import {
  restartDelayMs,
  shouldGiveUp,
  type RestartFailure,
} from "./restart-policy.ts";

/** The subset of a NodeJS.ReadableStream this supervisor reads from. */
export interface ReadableLike {
  on(event: "data", fn: (chunk: Buffer | string) => void): void;
}

/** The part of Electron's UtilityProcess this supervisor uses. */
export interface ForkedProcess {
  on(event: "spawn" | "exit" | "message" | "error", fn: (...args: any[]) => void): void;
  postMessage(message: unknown): void;
  kill(): boolean;
  /**
   * Only present when the process was forked with stdio "pipe" — see
   * electronForkFn. Optional so the plain unit-test double above, which has
   * neither, still satisfies this interface.
   */
  readonly stdout?: ReadableLike | null;
  readonly stderr?: ReadableLike | null;
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

/** One line of the child's stdout or stderr, as shown in the 서버 로그 panel. */
export interface LogLine {
  stream: "stdout" | "stderr";
  text: string;
  at: number;
}

/**
 * A 90-minute event must never let this grow without limit. 500 lines is
 * comfortably more than an engineer scrolls back through in practice, while
 * staying trivially cheap to re-send over IPC on every poll.
 */
export const MAX_LOG_LINES = 500;

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

  // The log is intentionally kept across a restart — an engineer diagnosing
  // why the server just crashed needs the line that caused it, and that line
  // was written by the child that just exited, not the one about to spawn.
  // Only the two line-in-progress buffers are per-child: a line split across
  // a restart boundary is not a real line either side of it.
  private readonly logListeners = new Set<(lines: readonly LogLine[]) => void>();
  private logLines: LogLine[] = [];
  private stdoutBuffer = "";
  private stderrBuffer = "";

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

  /** Newest last. Bounded to MAX_LOG_LINES; survives restarts. */
  get logs(): readonly LogLine[] {
    return this.logLines;
  }

  onLog(fn: (lines: readonly LogLine[]) => void): () => void {
    this.logListeners.add(fn);
    return () => {
      this.logListeners.delete(fn);
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

  /**
   * Hands a new brand to the running server, which applies it to the next
   * /config a phone asks for — no restart, so an operator fixing a misspelled
   * event name does not drop every listener in the room to do it.
   *
   * A no-op when nothing is running. That is not a failure: the value is
   * already in settings, and buildServerEnv puts it in the environment of the
   * next spawn.
   */
  setBrand(brand: {
    name: string;
    accent: string;
    logoPath: string;
    theme: "dark" | "light" | "auto";
  }): void {
    this.child?.postMessage({ type: "brand", brand });
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
    // The old child's own exit handler is about to be skipped by the same
    // `this.child !== child` guard (that is the point of clearing above), so
    // it will never reach flushLogBuffers() for whatever partial line this
    // child had in flight. Flush it here instead, before spawn() below resets
    // the buffers for the new child.
    this.flushLogBuffers();
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
    // Fresh per child: a partial line left over from the previous process
    // (see flushLogBuffers in the exit handler below) is never this one's to
    // finish.
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    child.stdout?.on("data", (chunk) => this.appendLog("stdout", chunk));
    child.stderr?.on("data", (chunk) => this.appendLog("stderr", chunk));

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
      // A crash or a clean shutdown can both land mid-line — e.g. the entry's
      // final console.log before process.exit(0) has no guaranteed trailing
      // newline. Flush whatever is buffered so that line is not lost.
      this.flushLogBuffers();
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

  /**
   * A pipe delivers bytes as they become available, not aligned to line
   * boundaries, so a single console.log call can arrive split across two
   * "data" events — or two calls can arrive coalesced into one. Buffer per
   * stream and only turn a segment into a line once a "\n" has actually
   * been seen for it.
   */
  private appendLog(stream: "stdout" | "stderr", chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const combined = (stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer) + text;
    const lines = combined.split("\n");
    const remainder = lines.pop() ?? "";
    if (stream === "stdout") this.stdoutBuffer = remainder;
    else this.stderrBuffer = remainder;
    this.pushLines(stream, lines);
  }

  private flushLogBuffers(): void {
    if (this.stdoutBuffer) {
      this.pushLines("stdout", [this.stdoutBuffer]);
      this.stdoutBuffer = "";
    }
    if (this.stderrBuffer) {
      this.pushLines("stderr", [this.stderrBuffer]);
      this.stderrBuffer = "";
    }
  }

  private pushLines(stream: "stdout" | "stderr", lines: string[]): void {
    if (lines.length === 0) return;
    const now = this.opts.now();
    for (const line of lines) {
      this.logLines.push({ stream, text: line, at: now });
      // Restores, for the stdout case, the visibility that stdio: "inherit"
      // used to give for free in development — now piped instead of
      // inherited so it can also be captured for the panel above.
      if (stream === "stderr") console.error(line);
      else console.log(line);
    }
    if (this.logLines.length > MAX_LOG_LINES) {
      this.logLines.splice(0, this.logLines.length - MAX_LOG_LINES);
    }
    for (const fn of this.logListeners) {
      try {
        fn(this.logLines);
      } catch (err) {
        console.error("server log listener threw", err);
      }
    }
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
      // Piped, not inherited: a packaged app run from the venue laptop's
      // Start Menu has no terminal for "inherit" to land in, so stdout/stderr
      // must come back through this process to reach the 서버 로그 panel —
      // the only place the engineer can see them either way. pushLines()
      // still echoes every line to this process's own console.log/error, so
      // stdio: "inherit"'s old benefit for a dev-mode terminal is not lost.
      stdio: "pipe",
    }) as unknown as ForkedProcess;
}
