import { describe, expect, test } from "vitest";
import { nextAnnouncement } from "./announce.ts";
import type { UpdateState } from "./update-state.ts";

const ready = (version: string): UpdateState => ({ status: "ready", version, message: null });

describe("nextAnnouncement", () => {
  test("nothing to say unless an update is staged", () => {
    expect(nextAnnouncement({ status: "idle", version: null, message: null }, null)).toBeNull();
    expect(nextAnnouncement({ status: "checking", version: null, message: null }, null)).toBeNull();
    expect(nextAnnouncement({ status: "error", version: null, message: "x" }, null)).toBeNull();
    expect(nextAnnouncement({ status: "ready", version: null, message: null }, null)).toBeNull();
  });

  test("announces a staged version once", () => {
    expect(nextAnnouncement(ready("0.2.0"), null)).toBe("0.2.0");
    expect(nextAnnouncement(ready("0.2.0"), "0.2.0")).toBeNull();
  });

  test("announces again only for a different version", () => {
    expect(nextAnnouncement(ready("0.3.0"), "0.2.0")).toBe("0.3.0");
  });
});
