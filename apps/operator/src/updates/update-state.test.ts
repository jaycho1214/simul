import { describe, expect, test } from "vitest";
import {
  DISABLED_UPDATE_STATE,
  INITIAL_UPDATE_STATE,
  describeUpdateEvent,
  reduceUpdateState,
  type UpdateEvent,
  type UpdateState,
} from "./update-state.ts";

function run(events: UpdateEvent[], from: UpdateState = INITIAL_UPDATE_STATE): UpdateState {
  return events.reduce(reduceUpdateState, from);
}

describe("reduceUpdateState", () => {
  test("starts idle with nothing known", () => {
    expect(INITIAL_UPDATE_STATE).toEqual({ status: "idle", version: null, message: null });
    expect(DISABLED_UPDATE_STATE).toEqual({ status: "disabled", version: null, message: null });
  });

  test("follows Electron's documented sequence to ready", () => {
    expect(run([{ type: "checking-for-update" }]).status).toBe("checking");
    expect(run([{ type: "checking-for-update" }, { type: "update-available" }]).status).toBe(
      "downloading",
    );
    expect(
      run([
        { type: "checking-for-update" },
        { type: "update-available" },
        { type: "update-downloaded", version: "0.2.0" },
      ]),
    ).toEqual({ status: "ready", version: "0.2.0", message: null });
  });

  test("a check that finds nothing returns to idle", () => {
    expect(run([{ type: "checking-for-update" }, { type: "update-not-available" }])).toEqual(
      INITIAL_UPDATE_STATE,
    );
  });

  test("an error from any state before ready is reported and clears the version", () => {
    for (const from of [
      INITIAL_UPDATE_STATE,
      run([{ type: "checking-for-update" }]),
      run([{ type: "checking-for-update" }, { type: "update-available" }]),
    ]) {
      expect(reduceUpdateState(from, { type: "error", message: "ENOTFOUND" })).toEqual({
        status: "error",
        version: null,
        message: "ENOTFOUND",
      });
    }
  });

  test("ready is sticky: a later check, miss or error never hides a staged update", () => {
    const ready = run([{ type: "update-downloaded", version: "0.2.0" }]);
    expect(reduceUpdateState(ready, { type: "checking-for-update" })).toBe(ready);
    expect(reduceUpdateState(ready, { type: "update-not-available" })).toBe(ready);
    expect(reduceUpdateState(ready, { type: "error", message: "offline" })).toBe(ready);
    expect(reduceUpdateState(ready, { type: "update-available" })).toBe(ready);
  });

  test("a newer staged version replaces the ready one", () => {
    const ready = run([{ type: "update-downloaded", version: "0.2.0" }]);
    expect(reduceUpdateState(ready, { type: "update-downloaded", version: "0.3.0" })).toEqual({
      status: "ready",
      version: "0.3.0",
      message: null,
    });
  });

  test("an unchanged state is returned by identity, so callers can skip logging", () => {
    expect(reduceUpdateState(INITIAL_UPDATE_STATE, { type: "update-not-available" })).toBe(
      INITIAL_UPDATE_STATE,
    );
  });

  test("describes events for the log", () => {
    expect(describeUpdateEvent({ type: "checking-for-update" })).toBe("checking for updates");
    expect(describeUpdateEvent({ type: "update-available" })).toBe("update available, downloading");
    expect(describeUpdateEvent({ type: "update-not-available" })).toBe("up to date");
    expect(describeUpdateEvent({ type: "update-downloaded", version: "0.2.0" })).toBe(
      "v0.2.0 downloaded, restart to apply",
    );
    expect(describeUpdateEvent({ type: "error", message: "boom" })).toBe("error: boom");
  });
});
