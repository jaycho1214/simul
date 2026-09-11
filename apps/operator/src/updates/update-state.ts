/**
 * What the window needs to know about updates, reduced from Electron's
 * autoUpdater events. Pure: the renderer imports the type and the tests drive
 * the reducer, so nothing here may touch Electron or Node.
 */
export type UpdateStatus = "disabled" | "idle" | "checking" | "downloading" | "ready" | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** The staged version once status is "ready" — "0.2.0", without the v. */
  version: string | null;
  /** The last error's message while status is "error". */
  message: string | null;
}

export type UpdateEvent =
  | { type: "checking-for-update" }
  | { type: "update-available" }
  | { type: "update-not-available" }
  | { type: "update-downloaded"; version: string }
  | { type: "error"; message: string };

export const INITIAL_UPDATE_STATE: UpdateState = Object.freeze({
  status: "idle",
  version: null,
  message: null,
});

/** Development, macOS, or anything unpackaged: no checks ever run. */
export const DISABLED_UPDATE_STATE: UpdateState = Object.freeze({
  status: "disabled",
  version: null,
  message: null,
});

/**
 * "ready" is sticky. Squirrel has already installed the new version beside
 * the running one by the time update-downloaded fires; an hourly re-check
 * that then fails because the venue is offline must not take the restart
 * affordance away. Only a newer download changes a ready state.
 *
 * Returns the same object when nothing changes, so the caller can log
 * transitions and only transitions.
 */
export function reduceUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  if (state.status === "ready" && event.type !== "update-downloaded") return state;

  switch (event.type) {
    case "checking-for-update":
      return { status: "checking", version: null, message: null };
    case "update-available":
      return { status: "downloading", version: null, message: null };
    case "update-not-available":
      return state.status === "idle" ? state : { status: "idle", version: null, message: null };
    case "update-downloaded":
      return { status: "ready", version: event.version, message: null };
    case "error":
      return { status: "error", version: null, message: event.message };
  }
}

/** One line per event for the server-log panel, prefixed by the caller. */
export function describeUpdateEvent(event: UpdateEvent): string {
  switch (event.type) {
    case "checking-for-update":
      return "checking for updates";
    case "update-available":
      return "update available, downloading";
    case "update-not-available":
      return "up to date";
    case "update-downloaded":
      return `v${event.version} downloaded, restart to apply`;
    case "error":
      return `error: ${event.message}`;
  }
}
