import { describe, expect, test } from "vitest";
import { KO_STRINGS } from "./i18n.ts";

/** Every leaf string in the table, with its dotted key. */
function leaves(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("Korean string table", () => {
  test("carries a label for every panel in the window", () => {
    expect(KO_STRINGS.panel).toEqual({
      device: "입력 장치",
      level: "레벨 미터",
      join: "접속 정보",
      lanes: "레인 현황",
      control: "제어",
      brand: "행사 브랜드",
    });
  });

  test("carries the six lane columns from the spec", () => {
    expect([
      KO_STRINGS.lanes.language,
      KO_STRINGS.lanes.listeners,
      KO_STRINGS.lanes.status,
      KO_STRINGS.lanes.laneDrops,
      KO_STRINGS.lanes.listenerDrops,
      KO_STRINGS.lanes.sessionState,
    ]).toEqual(["언어", "청취자 수", "상태", "레인 드롭", "청취자 드롭", "세션 상태"]);
  });

  test("start and stop are the spec's 시작 / 중지", () => {
    expect(KO_STRINGS.control.start).toBe("시작");
    expect(KO_STRINGS.control.stop).toBe("중지");
  });

  test("has one entry per LaneState", () => {
    expect(Object.keys(KO_STRINGS.laneState).sort()).toEqual([
      "error",
      "live",
      "reconnecting",
      "starting",
    ]);
  });

  test("contains no Latin-script user-facing copy", () => {
    // Digits and punctuation survive the Korean filter and are not English copy.
    const allowed = /^[\s\d.,:%°/·()—-]*$/;
    const offenders = leaves(KO_STRINGS)
      // Interpolation placeholders are structure, not copy.
      .map(([key, value]) => [key, value.replace(/\{\{\w+\}\}/g, "")] as const)
      .filter(([key]) => key !== "level.rms" && key !== "reach.macos")
      .filter(([, value]) => {
        const latinOnly = value.replace(/[^\x00-\x7F]/g, "");
        return latinOnly.length > 0 && !allowed.test(latinOnly);
      })
      .map(([key]) => key);

    // Keys that legitimately embed an English product, unit or protocol token.
    const expected = [
      "device.dspOff", // DSP
      "device.sampleRate", // Hz
      "warn.channel_downmix", // USB
      "warn.dsp_enabled", // DSP
      "warn.dsp_unreported", // DSP
      "warn.sample_rate_mismatch", // Hz
      "join.scan", // QR
      "join.noAddress", // LAN
      "reach.profile_pass", // (Private)
      "reach.profile_warn", // (Public)
      "reach.rule_warn", // TCP
      "control.apiKey", // Gemini API
      "control.server_external", // --external-server
      "brand.accentPlaceholder", // #3e8fd0 — a colour value, not copy
      "brand.accentInvalid", // quotes the same colour value back
      "lang.autoDetect", // Gemini
      "lang.passthroughHint", // API
      "lang.addHint", // Gemini, BCP-47
    ];
    expect(offenders.sort()).toEqual(expected.sort());
  });
});
