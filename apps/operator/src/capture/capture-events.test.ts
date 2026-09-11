import { describe, expect, test } from "vitest";
import type { CaptureSnapshot } from "./capture-controller.ts";
import { captureEvents } from "./capture-events.ts";

const idle: CaptureSnapshot = {
  running: false,
  report: undefined,
  ingestState: "idle",
  sentFrames: 0,
  droppedFrames: 0,
  error: undefined,
};

const report: NonNullable<CaptureSnapshot["report"]> = {
  requestedChannelCount: 2,
  achievedChannelCount: 2,
  selectedChannelIndex: 1,
  deviceSampleRate: 48000,
  contextSampleRate: 16000,
  dsp: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  dspConfirmedOff: true,
  warnings: [],
};

// Every transition an engineer would want in the log, and nothing for a
// snapshot that only moved a frame counter — those change fifty times a second.
describe("captureEvents", () => {
  test("a frame-count tick is not an event", () => {
    expect(
      captureEvents({ ...idle, running: true }, { ...idle, running: true, sentFrames: 50 }),
    ).toEqual([]);
  });

  test("capture starting reports what actually opened", () => {
    expect(captureEvents(idle, { ...idle, running: true, report })).toEqual([
      { type: "started", report },
    ]);
  });

  test("capture stopping is one event, with no error attached", () => {
    expect(
      captureEvents({ ...idle, running: true, report }, { ...idle, ingestState: "stopped" }),
    ).toEqual([{ type: "stopped" }]);
  });

  test("a new error is reported once, and the same error is not repeated", () => {
    const error = { code: "deviceOpenFailed" as const, name: "NotReadableError", reason: "busy" };
    const failed = { ...idle, error };
    expect(captureEvents(idle, failed)).toEqual([{ type: "error", error }]);
    expect(captureEvents(failed, { ...failed, sentFrames: 1 })).toEqual([]);
  });

  test("the ingest socket going away and coming back are both events", () => {
    const live = { ...idle, running: true, report, ingestState: "open" as const };
    expect(captureEvents(live, { ...live, ingestState: "reconnecting" })).toEqual([
      { type: "ingest", state: "reconnecting", from: "open" },
    ]);
    expect(captureEvents({ ...live, ingestState: "reconnecting" }, live)).toEqual([
      { type: "ingest", state: "open", from: "reconnecting" },
    ]);
  });

  test("stopping does not also report the socket closing — that is the same act", () => {
    const live = { ...idle, running: true, report, ingestState: "open" as const };
    expect(captureEvents(live, { ...idle, ingestState: "stopped" })).toEqual([{ type: "stopped" }]);
  });
});
