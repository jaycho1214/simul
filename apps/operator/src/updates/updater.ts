import {
  DISABLED_UPDATE_STATE,
  INITIAL_UPDATE_STATE,
  describeUpdateEvent,
  reduceUpdateState,
  type UpdateEvent,
  type UpdateState,
} from "./update-state.ts";

/** The slice of Electron's autoUpdater this class needs; a fake in tests. */
export interface AutoUpdaterLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

export interface UpdaterOptions {
  /** Packaged on win32 (or the dev fake). Off means no timer, no network, ever. */
  enabled: boolean;
  autoUpdater: AutoUpdaterLike;
  /** Sets the feed URL and starts the periodic check; called once from start(). */
  boot: () => void;
  log: (line: string) => void;
}

/**
 * Owns the update state for the window. Electron's autoUpdater is injected
 * so the event wiring is testable; electron-updater.ts supplies the real one.
 */
export class Updater {
  private current: UpdateState;
  private started = false;

  constructor(private readonly opts: UpdaterOptions) {
    this.current = opts.enabled ? INITIAL_UPDATE_STATE : DISABLED_UPDATE_STATE;
  }

  get state(): UpdateState {
    return this.current;
  }

  start(): void {
    if (!this.opts.enabled || this.started) return;
    this.started = true;

    const au = this.opts.autoUpdater;
    au.on("checking-for-update", () => this.apply({ type: "checking-for-update" }));
    au.on("update-available", () => this.apply({ type: "update-available" }));
    au.on("update-not-available", () => this.apply({ type: "update-not-available" }));
    // (event, releaseNotes, releaseName, releaseDate, updateURL) — on Windows
    // releaseName is the version from the RELEASES file, e.g. "0.2.0".
    au.on("update-downloaded", (_event: unknown, _notes: unknown, releaseName: unknown) =>
      this.apply({ type: "update-downloaded", version: String(releaseName ?? "") }),
    );
    au.on("error", (err: unknown) =>
      this.apply({ type: "error", message: err instanceof Error ? err.message : String(err) }),
    );

    this.opts.boot();
  }

  /** A manual check — the "please update before the event" case. */
  check(): void {
    if (!this.started) return;
    this.opts.autoUpdater.checkForUpdates();
  }

  /** Quits into the staged version. False when there is nothing staged. */
  install(): boolean {
    if (this.current.status !== "ready") return false;
    this.opts.autoUpdater.quitAndInstall();
    return true;
  }

  private apply(event: UpdateEvent): void {
    const next = reduceUpdateState(this.current, event);
    if (next === this.current) return;
    this.current = next;
    this.opts.log(`[update] ${describeUpdateEvent(event)}`);
  }
}
