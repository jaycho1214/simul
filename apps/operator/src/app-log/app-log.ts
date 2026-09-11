/**
 * One line of the operator app's own log: what the window did and what
 * failed on it, as opposed to the forked server's stdout in
 * `ServerSupervisor.logs`. The 앱 tab of 서버 · 로그 renders these.
 */
export interface AppLogLine {
  level: "info" | "error";
  text: string;
  at: number;
}

/** Same bound as the server log, for the same reason: a long event must not grow it. */
export const MAX_APP_LOG_LINES = 500;

/**
 * The renderer's log. Exists because a capture failure used to be a six-pixel
 * dot on the rail and nothing else: getUserMedia rejected on the venue laptop
 * and the app had nowhere to say why. Everything the capture chain reports —
 * starts, what was opened, every error with its name, the ingest socket's
 * comings and goings — lands here, where the engineer can read it back
 * after the fact.
 *
 * Immutable snapshots, so useSyncExternalStore sees a new reference per line.
 */
export class AppLog {
  private lines: readonly AppLogLine[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  getSnapshot(): readonly AppLogLine[] {
    return this.lines;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  info(text: string): void {
    this.push("info", text);
  }

  error(text: string): void {
    this.push("error", text);
  }

  private push(level: AppLogLine["level"], text: string): void {
    const next = [...this.lines, { level, text, at: this.now() }];
    this.lines =
      next.length > MAX_APP_LOG_LINES ? next.slice(next.length - MAX_APP_LOG_LINES) : next;
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error("app log subscriber threw", err);
      }
    }
  }
}
