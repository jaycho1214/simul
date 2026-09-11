import { randomBytes } from "node:crypto";
import { BRAND_THEMES, maskSecret, normalizeAccent, type BrandTheme } from "./brand.ts";

export {
  BRAND_THEMES,
  LOGO_EXTENSIONS,
  MAX_LOGO_BYTES,
  isServableLogo,
  logoDataUri,
  logoMimeType,
  maskSecret,
  normalizeAccent,
  storedLogoName,
  type BrandTheme,
} from "./brand.ts";

/** Chromium's ChannelSplitterNode tops out at 32 outputs. */
const MAX_CHANNELS = 32;

/**
 * Mirrors apps/server's src/config.ts exactly. loadConfig throws if OPUS_BITRATE
 * falls outside [MIN_OPUS_BITRATE, MAX_OPUS_BITRATE] — that throw happens inside
 * the forked utility process, after a lane may already be mid-construction, so
 * the bound here must match the server's, not just be "close enough".
 */
const MIN_OPUS_BITRATE = 6_000;
const MAX_OPUS_BITRATE = 510_000;

/**
 * What DEFAULT_SETTINGS.opusBitrate was before the server moved to 128 kbps.
 * At 24 kbps the server derives a ~16 s stream prime (see apps/server's
 * config.ts: the prime is sized to fill Chrome's 32 KiB block at the wire
 * byte rate), and a plain `<audio>` listener starts at the oldest byte sent,
 * so every phone sat 16 s behind the room. Nothing in the panels sets this
 * field, so a stored 24000 can only be getSettings() having written the old
 * default back to disk on first run — it is read as "unset", never as a choice.
 */
const LEGACY_DEFAULT_OPUS_BITRATE = 24_000;

/** Matches apps/server's MAX_LANE_GRACE_MS: past this a "grace" period never closes. */
const MAX_LANE_GRACE_MS = 3_600_000;

export interface OperatorSettings {
  deviceId: string | null;
  deviceLabel: string | null;
  channelIndex: number;
  requestedChannelCount: number;
  /** Which LAN address the engineer pinned, or null to auto-pick. */
  lanAddress: string | null;

  port: number;
  offeredLanguages: string[];
  /**
   * Offer the room's own audio, untranslated, as the `original` lane. A
   * debugging aid for checking the capture chain; off for an event, where
   * every lane goes through the model. There is no source language: the
   * model detects what is being spoken.
   */
  passthroughLane: boolean;
  maxConcurrentLanes: number;
  laneGraceMs: number;
  transcriptHistoryLines: number;
  transcriptDelayMs: number;
  opusBitrate: number;

  geminiApiKey: string;
  ingestToken: string;

  /**
   * The attendee app's brand. Every field is null until the engineer sets it,
   * so an unbranded event is the default and buildServerEnv can tell "not
   * chosen" from "chosen to be empty".
   */
  brandName: string | null;
  brandAccent: string | null;
  brandLogoPath: string | null;
  brandTheme: BrandTheme | null;
}

/**
 * Everything except the two secrets. The API key is replaced by a flag and a
 * mask — "is one saved" and "which one", without the key itself ever reaching
 * a renderer, a console.log, or a screen at a sound desk people walk past.
 */
export type PublicSettings = Omit<OperatorSettings, "geminiApiKey" | "ingestToken"> & {
  hasGeminiApiKey: boolean;
  geminiApiKeyMask: string | null;
};

export function generateIngestToken(
  bytes: () => string = () => randomBytes(16).toString("hex"),
): string {
  return bytes();
}

export const DEFAULT_SETTINGS: OperatorSettings = Object.freeze({
  deviceId: null,
  deviceLabel: null,
  channelIndex: 0,
  requestedChannelCount: 2,
  lanAddress: null,

  port: 8080,
  offeredLanguages: ["ko", "en", "es", "ja"],
  passthroughLane: false,
  maxConcurrentLanes: 6,
  laneGraceMs: 60000,
  transcriptHistoryLines: 200,
  transcriptDelayMs: 0,
  opusBitrate: 128_000,

  geminiApiKey: "",
  ingestToken: "",

  brandName: null,
  brandAccent: null,
  brandLogoPath: null,
  brandTheme: null,
});

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Whole-number field with a valid range: anything out of range falls back to the default. */
function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const truncated = Math.trunc(value);
  if (truncated < min || truncated > max) return fallback;
  return truncated;
}

/** Whole-number field that is clamped into range rather than reset — used for device-shaped values. */
function clampedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function langList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  if (!value.every((v) => typeof v === "string" && v.length > 0)) return [...fallback];
  return value as string[];
}

/**
 * Reads whatever is in the store, including a file written by an earlier build
 * or hand-edited on a venue laptop, and returns something every later stage can
 * rely on. Never throws — a corrupt settings file must not stop the app booting
 * an hour before an event.
 */
export function normalizeSettings(raw: unknown): OperatorSettings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  // A file from an older build carries a `sourceLanguage`; it is simply not
  // read. That language is still offered (it was always in the list), just as
  // a translation like every other.
  const offeredLanguages = langList(source.offeredLanguages, DEFAULT_SETTINGS.offeredLanguages);

  return {
    deviceId: nullableStr(source.deviceId),
    deviceLabel: nullableStr(source.deviceLabel),
    channelIndex: clampedInt(
      source.channelIndex,
      DEFAULT_SETTINGS.channelIndex,
      0,
      MAX_CHANNELS - 1,
    ),
    requestedChannelCount: clampedInt(
      source.requestedChannelCount,
      DEFAULT_SETTINGS.requestedChannelCount,
      1,
      MAX_CHANNELS,
    ),
    lanAddress: nullableStr(source.lanAddress),

    port: int(source.port, DEFAULT_SETTINGS.port, 1, 65535),
    offeredLanguages,
    passthroughLane: source.passthroughLane === true,
    maxConcurrentLanes: int(source.maxConcurrentLanes, DEFAULT_SETTINGS.maxConcurrentLanes, 1, 64),
    laneGraceMs: int(source.laneGraceMs, DEFAULT_SETTINGS.laneGraceMs, 0, MAX_LANE_GRACE_MS),
    transcriptHistoryLines: int(
      source.transcriptHistoryLines,
      DEFAULT_SETTINGS.transcriptHistoryLines,
      1,
      10_000,
    ),
    transcriptDelayMs: int(source.transcriptDelayMs, DEFAULT_SETTINGS.transcriptDelayMs, 0, 60_000),
    opusBitrate: int(
      source.opusBitrate === LEGACY_DEFAULT_OPUS_BITRATE ? undefined : source.opusBitrate,
      DEFAULT_SETTINGS.opusBitrate,
      MIN_OPUS_BITRATE,
      MAX_OPUS_BITRATE,
    ),

    brandName: nullableStr(typeof source.brandName === "string" ? source.brandName.trim() : null),
    brandAccent: normalizeAccent(source.brandAccent),
    brandLogoPath: nullableStr(source.brandLogoPath),
    brandTheme: BRAND_THEMES.includes(source.brandTheme as BrandTheme)
      ? (source.brandTheme as BrandTheme)
      : null,

    geminiApiKey: str(source.geminiApiKey, ""),
    // A regenerated token would silently orphan a running ingest socket, so an
    // existing one is always preserved.
    ingestToken: str(source.ingestToken, "") || generateIngestToken(),
  };
}

/** The only shape allowed to cross IPC into the renderer. */
export function redactSettings(settings: OperatorSettings): PublicSettings {
  const { geminiApiKey, ingestToken: _ingestToken, ...rest } = settings;
  return {
    ...rest,
    hasGeminiApiKey: geminiApiKey.length > 0,
    geminiApiKeyMask: maskSecret(geminiApiKey),
  };
}

/**
 * Every environment variable apps/server's loadConfig reads for the event's
 * configuration. `serverEnv()` strips each of them from the inherited
 * environment, so the settings store is the server's only source when it runs
 * inside this app: a stale value in the shell or a .env file can neither stand
 * in for nor shadow what the engineer set in the panels. (An invalid key saved
 * here once sat on top of a valid one in .env through a whole rehearsal, and
 * nothing on screen could say which the server was using.) SOURCE_LANGUAGE is
 * kept only so an old .env cannot reach a new server. WEB_ROOT is not here:
 * it says where the built attendee app lives, and main.ts owns it.
 */
export const SERVER_ENV_KEYS: readonly string[] = [
  "GEMINI_API_KEY",
  "INGEST_TOKEN",
  "PORT",
  "OFFERED_LANGUAGES",
  "PASSTHROUGH_LANE",
  "SOURCE_LANGUAGE",
  "MAX_CONCURRENT_LANES",
  "LANE_GRACE_MS",
  "TRANSCRIPT_HISTORY_LINES",
  "TRANSCRIPT_DELAY_MS",
  "OPUS_BITRATE",
  "STREAM_PRIME_MS",
  "BRAND_NAME",
  "BRAND_ACCENT",
  "BRAND_LOGO",
  "BRAND_THEME",
];

/**
 * Exactly the variables apps/server's loadConfig reads, from settings and
 * nothing else. The two secrets are always present, empty when unset: an
 * empty GEMINI_API_KEY makes the server refuse to start with a message the
 * control panel shows, which is the honest outcome — the key belongs in 제어,
 * and nothing inherited is allowed to paper over its absence. Brand fields
 * are omitted when unset so the server applies its own defaults.
 */
export function buildServerEnv(settings: OperatorSettings): Record<string, string> {
  const env: Record<string, string> = {
    GEMINI_API_KEY: settings.geminiApiKey,
    INGEST_TOKEN: settings.ingestToken,
    PORT: String(settings.port),
    OFFERED_LANGUAGES: JSON.stringify(settings.offeredLanguages),
    PASSTHROUGH_LANE: settings.passthroughLane ? "true" : "false",
    MAX_CONCURRENT_LANES: String(settings.maxConcurrentLanes),
    LANE_GRACE_MS: String(settings.laneGraceMs),
    TRANSCRIPT_HISTORY_LINES: String(settings.transcriptHistoryLines),
    TRANSCRIPT_DELAY_MS: String(settings.transcriptDelayMs),
    OPUS_BITRATE: String(settings.opusBitrate),
  };
  if (settings.brandName) env.BRAND_NAME = settings.brandName;
  if (settings.brandAccent) env.BRAND_ACCENT = settings.brandAccent;
  if (settings.brandLogoPath) env.BRAND_LOGO = settings.brandLogoPath;
  if (settings.brandTheme) env.BRAND_THEME = settings.brandTheme;
  return env;
}

/**
 * The environment the server is spawned with: the process's own, minus every
 * server variable, plus the settings. Whatever a .env or the shell says about
 * the event is discarded here — `pnpm serve`, the headless server with no
 * settings store, is the only entry point that reads .env.
 */
export function serverEnv(
  inherited: Record<string, string | undefined>,
  settings: OperatorSettings,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && !SERVER_ENV_KEYS.includes(key)) env[key] = value;
  }
  return { ...env, ...buildServerEnv(settings) };
}
