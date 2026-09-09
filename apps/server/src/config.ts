import type { LangCode } from "@tongyeok/protocol";

export interface Config {
  readonly geminiApiKey: string;
  readonly ingestToken: string;
  readonly port: number;
  readonly sourceLanguage: LangCode;
  readonly offeredLanguages: readonly LangCode[];
  readonly maxConcurrentLanes: number;
  readonly laneGraceMs: number;
  readonly transcriptHistoryLines: number;
  readonly transcriptDelayMs: number;
  readonly opusBitrate: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got ${raw}`);
  return n;
}

export function loadConfig(env: Env = process.env): Config {
  const offeredLanguages: LangCode[] = env.OFFERED_LANGUAGES
    ? JSON.parse(env.OFFERED_LANGUAGES)
    : ["ko", "en", "es", "ja"];
  const sourceLanguage = env.SOURCE_LANGUAGE ?? "ko";

  if (!offeredLanguages.includes(sourceLanguage)) {
    throw new Error(`SOURCE_LANGUAGE ${sourceLanguage} is not in OFFERED_LANGUAGES`);
  }

  return Object.freeze({
    geminiApiKey: required(env, "GEMINI_API_KEY"),
    ingestToken: required(env, "INGEST_TOKEN"),
    port: num(env, "PORT", 8080),
    sourceLanguage,
    offeredLanguages: Object.freeze(offeredLanguages),
    maxConcurrentLanes: num(env, "MAX_CONCURRENT_LANES", 6),
    laneGraceMs: num(env, "LANE_GRACE_MS", 60000),
    transcriptHistoryLines: num(env, "TRANSCRIPT_HISTORY_LINES", 200),
    transcriptDelayMs: num(env, "TRANSCRIPT_DELAY_MS", 0),
    opusBitrate: num(env, "OPUS_BITRATE", 24000),
  });
}
