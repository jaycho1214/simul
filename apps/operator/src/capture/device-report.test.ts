import { describe, expect, test } from "vitest";
import { buildDeviceReport, clampChannelIndex } from "./device-report.ts";

const base = {
  requestedChannelCount: 2,
  selectedChannelIndex: 0,
  contextSampleRate: 16000,
  settings: {
    channelCount: 2,
    sampleRate: 48000,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  } as MediaTrackSettings,
};

describe("buildDeviceReport", () => {
  test("a clean device produces no warnings and confirms the DSP is off", () => {
    const report = buildDeviceReport(base);
    expect(report.warnings).toEqual([]);
    expect(report.dspConfirmedOff).toBe(true);
    expect(report.achievedChannelCount).toBe(2);
    expect(report.requestedChannelCount).toBe(2);
    expect(report.deviceSampleRate).toBe(48000);
    expect(report.contextSampleRate).toBe(16000);
  });

  test("warns when Chromium delivers fewer channels than requested", () => {
    const report = buildDeviceReport({
      ...base,
      requestedChannelCount: 18,
      settings: { ...base.settings, channelCount: 2 },
    });
    expect(report.warnings).toContainEqual({
      code: "channel_downmix",
      requested: 18,
      achieved: 2,
    });
  });

  test("does not warn when the device simply has fewer channels than the maximum", () => {
    const report = buildDeviceReport({
      ...base,
      requestedChannelCount: 2,
      settings: { ...base.settings, channelCount: 2 },
    });
    expect(report.warnings.map((w) => w.code)).not.toContain("channel_downmix");
  });

  test("warns when the picked channel index is outside the achieved count", () => {
    const report = buildDeviceReport({
      ...base,
      selectedChannelIndex: 5,
      settings: { ...base.settings, channelCount: 2 },
    });
    expect(report.warnings).toContainEqual({
      code: "channel_out_of_range",
      selected: 5,
      achieved: 2,
    });
  });

  test("warns for every DSP flag the browser left on", () => {
    const report = buildDeviceReport({
      ...base,
      settings: { ...base.settings, autoGainControl: true, noiseSuppression: true },
    });
    expect(report.dspConfirmedOff).toBe(false);
    expect(report.warnings).toContainEqual({
      code: "dsp_enabled",
      flags: ["noiseSuppression", "autoGainControl"],
    });
  });

  test("distinguishes 'the browser said nothing' from 'the browser said off'", () => {
    const report = buildDeviceReport({
      ...base,
      settings: { channelCount: 2, sampleRate: 48000, echoCancellation: false },
    });
    expect(report.dspConfirmedOff).toBe(false);
    expect(report.warnings).toContainEqual({
      code: "dsp_unreported",
      flags: ["noiseSuppression", "autoGainControl"],
    });
    expect(report.warnings.map((w) => w.code)).not.toContain("dsp_enabled");
  });

  test("warns when the AudioContext did not open at 16 kHz", () => {
    const report = buildDeviceReport({ ...base, contextSampleRate: 48000 });
    expect(report.warnings).toContainEqual({
      code: "sample_rate_mismatch",
      expected: 16000,
      actual: 48000,
    });
  });

  test("a missing channelCount is treated as mono, not as unknown", () => {
    const report = buildDeviceReport({
      ...base,
      requestedChannelCount: 8,
      settings: {
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    expect(report.achievedChannelCount).toBe(1);
    expect(report.warnings).toContainEqual({
      code: "channel_downmix",
      requested: 8,
      achieved: 1,
    });
  });

  test("collects several warnings at once", () => {
    const report = buildDeviceReport({
      requestedChannelCount: 18,
      selectedChannelIndex: 9,
      contextSampleRate: 44100,
      settings: { channelCount: 2, sampleRate: 48000, autoGainControl: true },
    });
    expect(report.warnings.map((w) => w.code).sort()).toEqual([
      "channel_downmix",
      "channel_out_of_range",
      "dsp_enabled",
      "dsp_unreported",
      "sample_rate_mismatch",
    ]);
  });
});

describe("clampChannelIndex", () => {
  test("keeps a valid index", () => {
    expect(clampChannelIndex(3, 8)).toBe(3);
  });

  test("clamps above the achieved count", () => {
    expect(clampChannelIndex(11, 2)).toBe(1);
  });

  test("clamps below zero", () => {
    expect(clampChannelIndex(-1, 8)).toBe(0);
  });

  test("a zero-channel device still yields index 0", () => {
    expect(clampChannelIndex(4, 0)).toBe(0);
  });
});
