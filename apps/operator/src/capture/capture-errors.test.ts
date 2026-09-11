import { describe, expect, test } from "vitest";
import { captureErrorHint, describeCaptureCause } from "./capture-errors.ts";

// The names Chromium's getUserMedia rejects with on Windows, each pointing at
// a different thing the engineer has to do. The reason getUserMedia gives is
// often just "Could not start audio source" — the name is what carries the
// actionable difference, so the copy is keyed on it.
describe("captureErrorHint", () => {
  test("a system-level denial points at the Windows privacy setting", () => {
    expect(captureErrorHint("NotAllowedError")).toBe("notAllowed");
    expect(captureErrorHint("PermissionDeniedError")).toBe("notAllowed");
  });

  test("a device that will not start points at whatever else holds it", () => {
    expect(captureErrorHint("NotReadableError")).toBe("notReadable");
    expect(captureErrorHint("TrackStartError")).toBe("notReadable");
    expect(captureErrorHint("AbortError")).toBe("notReadable");
  });

  test("a device that is gone or cannot meet the request points at re-picking it", () => {
    expect(captureErrorHint("NotFoundError")).toBe("notFound");
    expect(captureErrorHint("OverconstrainedError")).toBe("notFound");
    expect(captureErrorHint("DevicesNotFoundError")).toBe("notFound");
  });

  test("anything else gets no hint rather than a wrong one", () => {
    expect(captureErrorHint("TypeError")).toBeUndefined();
    expect(captureErrorHint("")).toBeUndefined();
  });
});

describe("describeCaptureCause", () => {
  test("keeps a DOMException's name and message apart", () => {
    const err = new DOMException("Could not start audio source", "NotReadableError");
    expect(describeCaptureCause(err)).toEqual({
      name: "NotReadableError",
      reason: "Could not start audio source",
    });
  });

  // Chromium's OverconstrainedError carries no message at all; the failing
  // constraint's name is the only thing that says what went wrong.
  test("names the failing constraint when there is no message", () => {
    const err = Object.assign(new DOMException("", "OverconstrainedError"), {
      constraint: "deviceId",
    });
    expect(describeCaptureCause(err)).toEqual({
      name: "OverconstrainedError",
      reason: "constraint deviceId",
    });
    expect(describeCaptureCause(new DOMException("", "NotReadableError"))).toEqual({
      name: "NotReadableError",
      reason: "(no message)",
    });
  });

  test("survives a plain Error and a non-error throw", () => {
    expect(describeCaptureCause(new Error("no audio track"))).toEqual({
      name: "Error",
      reason: "no audio track",
    });
    expect(describeCaptureCause("weird")).toEqual({ name: "", reason: "weird" });
    expect(describeCaptureCause(undefined)).toEqual({ name: "", reason: "undefined" });
  });
});
