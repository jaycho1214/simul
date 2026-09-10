import { randomBytes } from "node:crypto";

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
  sourceLanguage: string;
  offeredLanguages: string[];
  maxConcurrentLanes: number;
  laneGraceMs: number;
  transcriptHistoryLines: number;
  transcriptDelayMs: number;
  opusBitrate: number;

  geminiApiKey: string;
  ingestToken: string;
}

/** Everything except the two secrets, plus a flag for whether the key is set. */
export type PublicSettings = Omit<OperatorSettings, "geminiApiKey" | "ingestToken"> & {
  hasGeminiApiKey: boolean;
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
  sourceLanguage: "ko",
  offeredLanguages: ["ko", "en", "es", "ja"],
  maxConcurrentLanes: 6,
  laneGraceMs: 60000,
  transcriptHistoryLines: 200,
  transcriptDelayMs: 0,
  opusBitrate: 24000,

  geminiApiKey: "",
  ingestToken: "",
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
  const source =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const sourceLanguage = str(source.sourceLanguage, DEFAULT_SETTINGS.sourceLanguage);
  const offered = langList(source.offeredLanguages, DEFAULT_SETTINGS.offeredLanguages);
  // The passthrough lane must exist or the server refuses to start.
  const offeredLanguages = offered.includes(sourceLanguage)
    ? offered
    : [sourceLanguage, ...offered];

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
    sourceLanguage,
    offeredLanguages,
    maxConcurrentLanes: int(
      source.maxConcurrentLanes,
      DEFAULT_SETTINGS.maxConcurrentLanes,
      1,
      64,
    ),
    laneGraceMs: int(source.laneGraceMs, DEFAULT_SETTINGS.laneGraceMs, 0, MAX_LANE_GRACE_MS),
    transcriptHistoryLines: int(
      source.transcriptHistoryLines,
      DEFAULT_SETTINGS.transcriptHistoryLines,
      1,
      10_000,
    ),
    transcriptDelayMs: int(
      source.transcriptDelayMs,
      DEFAULT_SETTINGS.transcriptDelayMs,
      0,
      60_000,
    ),
    opusBitrate: int(
      source.opusBitrate,
      DEFAULT_SETTINGS.opusBitrate,
      MIN_OPUS_BITRATE,
      MAX_OPUS_BITRATE,
    ),

    geminiApiKey: str(source.geminiApiKey, ""),
    // A regenerated token would silently orphan a running ingest socket, so an
    // existing one is always preserved.
    ingestToken: str(source.ingestToken, "") || generateIngestToken(),
  };
}

/** The only shape allowed to cross IPC into the renderer. */
export function redactSettings(settings: OperatorSettings): PublicSettings {
  const { geminiApiKey, ingestToken: _ingestToken, ...rest } = settings;
  return { ...rest, hasGeminiApiKey: geminiApiKey.length > 0 };
}

/** Exactly the variables apps/server's loadConfig reads, and nothing else. */
export function buildServerEnv(settings: OperatorSettings): Record<string, string> {
  return {
    GEMINI_API_KEY: settings.geminiApiKey,
    INGEST_TOKEN: settings.ingestToken,
    PORT: String(settings.port),
    SOURCE_LANGUAGE: settings.sourceLanguage,
    OFFERED_LANGUAGES: JSON.stringify(settings.offeredLanguages),
    MAX_CONCURRENT_LANES: String(settings.maxConcurrentLanes),
    LANE_GRACE_MS: String(settings.laneGraceMs),
    TRANSCRIPT_HISTORY_LINES: String(settings.transcriptHistoryLines),
    TRANSCRIPT_DELAY_MS: String(settings.transcriptDelayMs),
    OPUS_BITRATE: String(settings.opusBitrate),
  };
}
