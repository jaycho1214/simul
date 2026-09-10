import { describe, expect, test } from "vitest";
import {
  buildServerEnv,
  DEFAULT_SETTINGS,
  generateIngestToken,
  normalizeSettings,
  redactSettings,
} from "./schema.ts";

describe("DEFAULT_SETTINGS", () => {
  test("carries the spec's configuration defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      port: 8080,
      sourceLanguage: "ko",
      offeredLanguages: ["ko", "en", "es", "ja"],
      maxConcurrentLanes: 6,
      laneGraceMs: 60000,
      transcriptHistoryLines: 200,
      transcriptDelayMs: 0,
      opusBitrate: 24000,
    });
  });

  test("starts with no device chosen and channel 0", () => {
    expect(DEFAULT_SETTINGS.deviceId).toBeNull();
    expect(DEFAULT_SETTINGS.channelIndex).toBe(0);
    expect(DEFAULT_SETTINGS.requestedChannelCount).toBe(2);
  });
});

describe("normalizeSettings", () => {
  // DEFAULT_SETTINGS.ingestToken is "" because the constant is a static table;
  // normalizeSettings mints a real token, so it is matched rather than compared.
  const defaultsWithToken = {
    ...DEFAULT_SETTINGS,
    ingestToken: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown as string,
  };

  test("an empty store yields the defaults", () => {
    expect(normalizeSettings({})).toEqual(defaultsWithToken);
  });

  test("a null or non-object store yields the defaults", () => {
    expect(normalizeSettings(null)).toEqual(defaultsWithToken);
    expect(normalizeSettings("nonsense")).toEqual(defaultsWithToken);
  });

  test("keeps values it recognises", () => {
    const settings = normalizeSettings({
      deviceId: "abc",
      deviceLabel: "XR18 USB 5-6",
      channelIndex: 1,
      requestedChannelCount: 18,
      geminiApiKey: "key",
      port: 9000,
    });
    expect(settings).toMatchObject({
      deviceId: "abc",
      deviceLabel: "XR18 USB 5-6",
      channelIndex: 1,
      requestedChannelCount: 18,
      geminiApiKey: "key",
      port: 9000,
    });
  });

  test("clamps a channel index written by a previous, larger device", () => {
    expect(normalizeSettings({ channelIndex: -3 }).channelIndex).toBe(0);
    expect(normalizeSettings({ channelIndex: 2.7 }).channelIndex).toBe(2);
    expect(normalizeSettings({ channelIndex: 999 }).channelIndex).toBe(31);
  });

  test("clamps a port outside the legal range", () => {
    expect(normalizeSettings({ port: 0 }).port).toBe(8080);
    expect(normalizeSettings({ port: 70000 }).port).toBe(8080);
    expect(normalizeSettings({ port: "8080" }).port).toBe(8080);
  });

  test("rejects an offered-language list that is not an array of strings", () => {
    expect(normalizeSettings({ offeredLanguages: "ko,en" }).offeredLanguages).toEqual(
      DEFAULT_SETTINGS.offeredLanguages,
    );
    expect(normalizeSettings({ offeredLanguages: ["ko", 7] }).offeredLanguages).toEqual(
      DEFAULT_SETTINGS.offeredLanguages,
    );
  });

  test("forces the source language into the offered list", () => {
    const settings = normalizeSettings({
      sourceLanguage: "ko",
      offeredLanguages: ["en", "es"],
    });
    expect(settings.offeredLanguages).toEqual(["ko", "en", "es"]);
  });

  test("generates an ingest token when the store has none", () => {
    const settings = normalizeSettings({});
    expect(settings.ingestToken).toMatch(/^[0-9a-f]{32}$/);
  });

  test("keeps an existing ingest token so a restart does not orphan the socket", () => {
    expect(normalizeSettings({ ingestToken: "abc123" }).ingestToken).toBe("abc123");
  });
});

describe("generateIngestToken", () => {
  test("is 32 hex characters", () => {
    expect(generateIngestToken(() => "0".repeat(32))).toBe("0".repeat(32));
  });
});

describe("redactSettings", () => {
  test("never lets the API key or the ingest token cross into the renderer", () => {
    const publicView = redactSettings({
      ...DEFAULT_SETTINGS,
      geminiApiKey: "sk-secret",
      ingestToken: "tok",
    });
    expect(publicView).not.toHaveProperty("geminiApiKey");
    expect(publicView.hasGeminiApiKey).toBe(true);
    expect(JSON.stringify(publicView)).not.toContain("sk-secret");
  });

  test("reports a missing key so the UI can warn", () => {
    expect(redactSettings({ ...DEFAULT_SETTINGS, geminiApiKey: "" }).hasGeminiApiKey).toBe(
      false,
    );
  });

  test("keeps the ingest token out but the port in", () => {
    const publicView = redactSettings(DEFAULT_SETTINGS);
    expect(publicView).not.toHaveProperty("ingestToken");
    expect(publicView.port).toBe(8080);
  });
});

describe("buildServerEnv", () => {
  test("produces exactly the variables loadConfig reads", () => {
    const env = buildServerEnv({
      ...DEFAULT_SETTINGS,
      geminiApiKey: "sk-1",
      ingestToken: "tok-1",
    });
    expect(env).toEqual({
      GEMINI_API_KEY: "sk-1",
      INGEST_TOKEN: "tok-1",
      PORT: "8080",
      SOURCE_LANGUAGE: "ko",
      OFFERED_LANGUAGES: '["ko","en","es","ja"]',
      MAX_CONCURRENT_LANES: "6",
      LANE_GRACE_MS: "60000",
      TRANSCRIPT_HISTORY_LINES: "200",
      TRANSCRIPT_DELAY_MS: "0",
      OPUS_BITRATE: "24000",
    });
  });

  test("OFFERED_LANGUAGES is JSON, which is what loadConfig parses", () => {
    const env = buildServerEnv({
      ...DEFAULT_SETTINGS,
      offeredLanguages: ["ko", "fr"],
      geminiApiKey: "k",
      ingestToken: "t",
    });
    expect(JSON.parse(env.OFFERED_LANGUAGES!)).toEqual(["ko", "fr"]);
  });

  // main.ts merges this over process.env: { ...process.env, ...buildServerEnv(...) }.
  // An unset secret must be absent from the returned object, not present as
  // "", or the spread erases a key the engineer already exported in the shell
  // or a .env file — the server would then refuse to start on a fresh install
  // even though a perfectly good GEMINI_API_KEY was inherited.
  test("an empty geminiApiKey leaves an inherited process.env value intact", () => {
    const env = buildServerEnv({ ...DEFAULT_SETTINGS, geminiApiKey: "", ingestToken: "tok" });
    expect(env).not.toHaveProperty("GEMINI_API_KEY");

    const merged = { ...{ GEMINI_API_KEY: "sk-from-shell" }, ...env };
    expect(merged.GEMINI_API_KEY).toBe("sk-from-shell");
  });

  test("a non-empty geminiApiKey overrides an inherited process.env value", () => {
    const env = buildServerEnv({
      ...DEFAULT_SETTINGS,
      geminiApiKey: "sk-from-settings",
      ingestToken: "tok",
    });
    expect(env.GEMINI_API_KEY).toBe("sk-from-settings");

    const merged = { ...{ GEMINI_API_KEY: "sk-from-shell" }, ...env };
    expect(merged.GEMINI_API_KEY).toBe("sk-from-settings");
  });

  test("an empty ingestToken leaves an inherited process.env value intact", () => {
    const env = buildServerEnv({ ...DEFAULT_SETTINGS, geminiApiKey: "k", ingestToken: "" });
    expect(env).not.toHaveProperty("INGEST_TOKEN");

    const merged = { ...{ INGEST_TOKEN: "tok-from-shell" }, ...env };
    expect(merged.INGEST_TOKEN).toBe("tok-from-shell");
  });

  test("a non-empty ingestToken overrides an inherited process.env value", () => {
    const env = buildServerEnv({
      ...DEFAULT_SETTINGS,
      geminiApiKey: "k",
      ingestToken: "tok-from-settings",
    });
    expect(env.INGEST_TOKEN).toBe("tok-from-settings");

    const merged = { ...{ INGEST_TOKEN: "tok-from-shell" }, ...env };
    expect(merged.INGEST_TOKEN).toBe("tok-from-settings");
  });
});
