import { describe, expect, test } from "vitest";
import {
  buildServerEnv,
  DEFAULT_SETTINGS,
  generateIngestToken,
  normalizeSettings,
  redactSettings,
  serverEnv,
} from "./schema.ts";

describe("DEFAULT_SETTINGS", () => {
  test("carries the spec's configuration defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      port: 8080,
      offeredLanguages: ["ko", "en", "es", "ja"],
      passthroughLane: false,
      maxConcurrentLanes: 6,
      laneGraceMs: 60000,
      transcriptHistoryLines: 200,
      transcriptDelayMs: 0,
      opusBitrate: 128000,
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

  test("starts at unity gain and clamps a stored gain into the slider's range", () => {
    expect(DEFAULT_SETTINGS.inputGainDb).toBe(0);
    expect(normalizeSettings({ inputGainDb: 6 }).inputGainDb).toBe(6);
    expect(normalizeSettings({ inputGainDb: -9.5 }).inputGainDb).toBe(-9.5);
    expect(normalizeSettings({ inputGainDb: 80 }).inputGainDb).toBe(24);
    expect(normalizeSettings({ inputGainDb: -80 }).inputGainDb).toBe(-24);
    expect(normalizeSettings({ inputGainDb: "6" }).inputGainDb).toBe(0);
  });

  test("starts with no room measured, reduction off, and the default sensitivity", () => {
    expect(DEFAULT_SETTINGS.noiseProfile).toBeNull();
    expect(DEFAULT_SETTINGS.noiseReduction).toBe(false);
    expect(DEFAULT_SETTINGS.noiseSensitivityDb).toBe(6);

    const bins = Array.from({ length: 257 }, (_, i) => -70 + i / 100);
    const profile = { bins, gainDb: 3, levelDb: -48 };
    const settings = normalizeSettings({
      noiseProfile: profile,
      noiseReduction: true,
      noiseSensitivityDb: 12,
    });
    expect(settings.noiseProfile).toEqual(profile);
    expect(settings.noiseReduction).toBe(true);
    expect(settings.noiseSensitivityDb).toBe(12);

    // A profile from a build with a different frame size is not a profile.
    expect(
      normalizeSettings({ noiseProfile: { ...profile, bins: [1, 2, 3] } }).noiseProfile,
    ).toBeNull();
    expect(normalizeSettings({ noiseReduction: "yes" }).noiseReduction).toBe(false);
    expect(normalizeSettings({ noiseSensitivityDb: 99 }).noiseSensitivityDb).toBe(24);
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

  // There is no source language any more. A file from an older build still
  // carries one; it is ignored, and the list is taken exactly as saved.
  test("keeps the offered list as saved and ignores a stale sourceLanguage", () => {
    const settings = normalizeSettings({
      sourceLanguage: "ko",
      offeredLanguages: ["en", "es"],
    });
    expect(settings.offeredLanguages).toEqual(["en", "es"]);
    expect(settings).not.toHaveProperty("sourceLanguage");
  });

  test("reads the passthrough lane as on only for a literal true", () => {
    expect(normalizeSettings({ passthroughLane: true }).passthroughLane).toBe(true);
    expect(normalizeSettings({ passthroughLane: "true" }).passthroughLane).toBe(false);
    expect(normalizeSettings({}).passthroughLane).toBe(false);
  });

  test("generates an ingest token when the store has none", () => {
    const settings = normalizeSettings({});
    expect(settings.ingestToken).toMatch(/^[0-9a-f]{32}$/);
  });

  test("keeps an existing ingest token so a restart does not orphan the socket", () => {
    expect(normalizeSettings({ ingestToken: "abc123" }).ingestToken).toBe("abc123");
  });

  test("uiLanguage is null (follow the OS) unless it is one of the two codes", () => {
    expect(DEFAULT_SETTINGS.uiLanguage).toBeNull();
    expect(normalizeSettings({}).uiLanguage).toBeNull();
    expect(normalizeSettings({ uiLanguage: "en" }).uiLanguage).toBe("en");
    expect(normalizeSettings({ uiLanguage: "ko" }).uiLanguage).toBe("ko");
    expect(normalizeSettings({ uiLanguage: "fr" }).uiLanguage).toBeNull();
    expect(normalizeSettings({ uiLanguage: 3 }).uiLanguage).toBeNull();
  });

  test("uiLanguage never reaches the server environment", () => {
    const env = buildServerEnv({ ...DEFAULT_SETTINGS, uiLanguage: "en" });
    expect(Object.keys(env).some((k) => /LANG|UI_/.test(k) && k !== "OFFERED_LANGUAGES")).toBe(
      false,
    );
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
    expect(redactSettings({ ...DEFAULT_SETTINGS, geminiApiKey: "" }).hasGeminiApiKey).toBe(false);
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
      OFFERED_LANGUAGES: '["ko","en","es","ja"]',
      PASSTHROUGH_LANE: "false",
      MAX_CONCURRENT_LANES: "6",
      LANE_GRACE_MS: "60000",
      TRANSCRIPT_HISTORY_LINES: "200",
      TRANSCRIPT_DELAY_MS: "0",
      OPUS_BITRATE: "128000",
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

  // The settings store is the server's only configuration source inside this
  // app. An unset key is passed as empty — the server then refuses to start
  // with a message the control panel shows — rather than omitted, which once
  // let an inherited .env value stand in for it without anyone knowing.
  test("passes the secrets through as they are, empty included", () => {
    const env = buildServerEnv({ ...DEFAULT_SETTINGS, geminiApiKey: "", ingestToken: "tok" });
    expect(env.GEMINI_API_KEY).toBe("");
    expect(env.INGEST_TOKEN).toBe("tok");
  });
});

/**
 * Brand is the one part of the server's config an engineer sets from inside
 * this app rather than from a .env file, so it travels the same settings ->
 * buildServerEnv -> server env path as everything else.
 */
describe("brand settings", () => {
  test("start out unset, so an unbranded event needs no decisions", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      brandName: null,
      brandAccent: null,
      brandLogoPath: null,
      brandTheme: null,
    });
  });

  test("keeps what the engineer typed", () => {
    const s = normalizeSettings({
      brandName: "새문안 주일예배",
      brandAccent: "#E8B64C",
      brandLogoPath: "/Users/av/logo.png",
      brandTheme: "light",
    });
    expect(s.brandName).toBe("새문안 주일예배");
    expect(s.brandAccent).toBe("#e8b64c");
    expect(s.brandLogoPath).toBe("/Users/av/logo.png");
    expect(s.brandTheme).toBe("light");
  });

  test.each([
    ["#f80", "#ff8800"],
    ["e8b64c", "#e8b64c"],
    ["  #E8B64C  ", "#e8b64c"],
  ])("normalises the accent %j to %j", (input, expected) => {
    expect(normalizeSettings({ brandAccent: input }).brandAccent).toBe(expected);
  });

  // normalizeSettings reads a file a previous build wrote or an engineer
  // hand-edited an hour before doors, so it degrades rather than throwing —
  // the panel is what refuses a bad value at the point it is typed.
  test.each(["puce", "#12345", "", "   ", 42, null])("drops an unusable accent %j", (bad) => {
    expect(normalizeSettings({ brandAccent: bad }).brandAccent).toBeNull();
  });

  test("drops an unknown theme", () => {
    expect(normalizeSettings({ brandTheme: "sepia" }).brandTheme).toBeNull();
  });

  test("treats a blank event name as unset", () => {
    expect(normalizeSettings({ brandName: "   " }).brandName).toBeNull();
  });
});

describe("buildServerEnv brand keys", () => {
  test("passes everything the engineer set", () => {
    const env = buildServerEnv(
      normalizeSettings({
        brandName: "새문안 주일예배",
        brandAccent: "#e8b64c",
        brandLogoPath: "/Users/av/logo.png",
        brandTheme: "auto",
      }),
    );
    expect(env.BRAND_NAME).toBe("새문안 주일예배");
    expect(env.BRAND_ACCENT).toBe("#e8b64c");
    expect(env.BRAND_LOGO).toBe("/Users/av/logo.png");
    expect(env.BRAND_THEME).toBe("auto");
  });

  // Omitted rather than sent empty, so the server applies its own defaults
  // for a brand the engineer never touched.
  test("omits every brand key the engineer has not set", () => {
    const env = buildServerEnv(normalizeSettings({}));
    for (const key of ["BRAND_NAME", "BRAND_ACCENT", "BRAND_LOGO", "BRAND_THEME"]) {
      expect(env, key).not.toHaveProperty(key);
    }
  });
});

describe("redactSettings", () => {
  // The key itself must never cross into the renderer, but "is a key saved,
  // and is it the right one" is a question an engineer asks at setup — so the
  // last four characters come across and nothing else does.
  test("sends a mask instead of the key", () => {
    const s = redactSettings(normalizeSettings({ geminiApiKey: "AIzaSyD-abcdefghijklmnop3f9a" }));
    expect(s.geminiApiKeyMask).toBe("••••••••3f9a");
    expect(s.hasGeminiApiKey).toBe(true);
    expect(JSON.stringify(s)).not.toContain("AIzaSyD");
  });

  test("has no mask when no key is saved", () => {
    const s = redactSettings(normalizeSettings({}));
    expect(s.geminiApiKeyMask).toBeNull();
    expect(s.hasGeminiApiKey).toBe(false);
  });

  test("never carries the ingest token", () => {
    const s = redactSettings(normalizeSettings({ ingestToken: "secret-token-value" }));
    expect(JSON.stringify(s)).not.toContain("secret-token-value");
  });
});

/**
 * The bitrate is not a choice the engineer can make from the panels — no UI
 * sets it — so a stored value is always whatever DEFAULT_SETTINGS was when
 * getSettings() first wrote the file back. The default used to be 24 kbps,
 * which makes the server derive a ~16 s stream prime and puts every phone 16 s
 * behind the room; the server and the spec moved to 128 kbps for exactly that
 * reason (see apps/server/src/config.ts). A venue laptop that ran the old build
 * keeps the old number on disk forever unless it is read as "the old default".
 */
describe("opusBitrate", () => {
  test("defaults to the server's 128 kbps, not the old 24 kbps", () => {
    expect(DEFAULT_SETTINGS.opusBitrate).toBe(128_000);
    expect(normalizeSettings({}).opusBitrate).toBe(128_000);
  });

  test("migrates a stored copy of the old 24 kbps default to the new default", () => {
    expect(normalizeSettings({ opusBitrate: 24_000 }).opusBitrate).toBe(128_000);
  });

  test("keeps any other in-range value an engineer put in the file by hand", () => {
    expect(normalizeSettings({ opusBitrate: 96_000 }).opusBitrate).toBe(96_000);
    expect(normalizeSettings({ opusBitrate: 32_000 }).opusBitrate).toBe(32_000);
  });

  test("still falls back on an out-of-range value", () => {
    expect(normalizeSettings({ opusBitrate: 1_000 }).opusBitrate).toBe(128_000);
  });
});

/**
 * Either the panels or .env, never both: inside this app the settings store is
 * the server's only source, so whatever the shell or a .env file carries about
 * the event is stripped before the settings are laid on. The bug this guards
 * against is not hypothetical — an invalid key saved here sat on top of a
 * valid one in .env for a whole rehearsal, and nothing on screen said which
 * the server was using.
 */
describe("serverEnv", () => {
  const settings = normalizeSettings({
    geminiApiKey: "sk-from-settings",
    ingestToken: "tok-from-settings",
  });

  test("drops every server variable the process inherited, secrets first", () => {
    const env = serverEnv(
      {
        GEMINI_API_KEY: "sk-from-dotenv",
        INGEST_TOKEN: "tok-from-dotenv",
        OPUS_BITRATE: "24000",
        SOURCE_LANGUAGE: "ko",
        BRAND_NAME: "from .env",
        PATH: "/usr/bin",
      },
      settings,
    );
    expect(env.GEMINI_API_KEY).toBe("sk-from-settings");
    expect(env.INGEST_TOKEN).toBe("tok-from-settings");
    expect(env.OPUS_BITRATE).toBe("128000");
    expect(env).not.toHaveProperty("SOURCE_LANGUAGE");
    expect(env).not.toHaveProperty("BRAND_NAME");
    expect(env.PATH).toBe("/usr/bin");
  });

  test("skips inherited variables that are undefined", () => {
    const env = serverEnv({ HOME: undefined }, settings);
    expect(env).not.toHaveProperty("HOME");
  });

  test("an empty saved key is not rescued by an inherited one", () => {
    const env = serverEnv(
      { GEMINI_API_KEY: "sk-from-dotenv" },
      normalizeSettings({ ingestToken: "t" }),
    );
    expect(env.GEMINI_API_KEY).toBe("");
  });
});
