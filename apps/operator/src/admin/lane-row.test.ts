import { describe, expect, test } from "vitest";
import type { LaneStatus } from "@tongyeok/protocol";
import { anyExternalListener, toLaneRow } from "./lane-row.ts";

const lane = (patch: Partial<LaneStatus> = {}): LaneStatus => ({
  lang: "es",
  listeners: 0,
  audioListeners: 0,
  state: "live",
  laneDrops: 0,
  listenerDrops: 0,
  ageMs: 0,
  ...patch,
});

describe("toLaneRow", () => {
  test("상태 is 열림 when the lane is carrying listeners", () => {
    expect(toLaneRow(lane({ listeners: 4, audioListeners: 4 }))).toMatchObject({
      openKey: "laneOpen.open",
      sessionKey: "laneState.live",
      listeners: 4,
    });
  });

  test("상태 is 대기 for an open lane inside its grace period", () => {
    expect(toLaneRow(lane({ listeners: 0 })).openKey).toBe("laneOpen.waiting");
  });

  test("상태 is 오류 whenever the session is in error, listeners or not", () => {
    expect(toLaneRow(lane({ listeners: 9, audioListeners: 9, state: "error" }))).toMatchObject({
      openKey: "laneOpen.error",
      sessionKey: "laneState.error",
    });
  });

  test("세션 상태 tracks LaneState exactly", () => {
    const states = ["starting", "live", "reconnecting", "error"] as const;
    expect(states.map((state) => toLaneRow(lane({ state })).sessionKey)).toEqual([
      "laneState.starting",
      "laneState.live",
      "laneState.reconnecting",
      "laneState.error",
    ]);
  });

  test("carries both drop counters separately", () => {
    expect(toLaneRow(lane({ laneDrops: 12, listenerDrops: 5 }))).toMatchObject({
      laneDrops: 12,
      listenerDrops: 5,
    });
  });

  test("carries audioListeners separately from listeners, since that is the figure that moves on mute", () => {
    // listeners is max(audio, transcript) and holds steady when someone mutes;
    // audioListeners falls. Both must survive the row mapping or muting is
    // invisible to the operator.
    expect(toLaneRow(lane({ listeners: 4, audioListeners: 1 }))).toMatchObject({
      listeners: 4,
      audioListeners: 1,
    });
  });

  test("marks a lane that is dropping frames so the UI can highlight it", () => {
    expect(toLaneRow(lane({ laneDrops: 0, listenerDrops: 0 })).degraded).toBe(false);
    expect(toLaneRow(lane({ laneDrops: 1 })).degraded).toBe(true);
    expect(toLaneRow(lane({ listenerDrops: 1 })).degraded).toBe(true);
    expect(toLaneRow(lane({ state: "reconnecting" })).degraded).toBe(true);
  });

  test("labels the source lane with its endonym", () => {
    expect(toLaneRow(lane({ lang: "ko" })).label).toBe("한국어");
    expect(toLaneRow(lane({ lang: "en" })).label).toBe("English");
    expect(toLaneRow(lane({ lang: "es" })).label).toBe("Español");
    expect(toLaneRow(lane({ lang: "ja" })).label).toBe("日本語");
  });

  test("falls back to the raw code for a language with no endonym", () => {
    expect(toLaneRow(lane({ lang: "sw" })).label).toBe("sw");
  });
});

describe("anyExternalListener", () => {
  test("is false with no lanes", () => {
    expect(anyExternalListener([])).toBe(false);
  });

  test("is false while every lane is empty", () => {
    expect(anyExternalListener([lane(), lane({ lang: "ja" })])).toBe(false);
  });

  test("is true as soon as one lane has a listener", () => {
    // The operator app never subscribes to /listen, so any listener is a phone —
    // which is the only real proof the laptop is reachable from the LAN.
    expect(anyExternalListener([lane(), lane({ lang: "ja", listeners: 1 })])).toBe(true);
  });

  test("is true even when the listener's audio is muted, since presence — not audio — is what proves reachability", () => {
    expect(
      anyExternalListener([lane({ lang: "ja", listeners: 1, audioListeners: 0 })]),
    ).toBe(true);
  });
});
