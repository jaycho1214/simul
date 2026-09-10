import { fileURLToPath } from "node:url";
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
  /** Directory of the built attendee app. Empty disables static serving. */
  readonly webRoot: string;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

/**
 * Whole-number env var with a valid range.
 *
 * The empty-string case is the one that matters. `Number("")` is 0, so a
 * .env line left as `OPUS_BITRATE=` — a value commented out by deleting it
 * rather than by prefixing `#`, or a template variable that never got
 * substituted — used to become a bitrate of 0. libopus rejects that with
 * "Encoder CTL error: Bad argument", thrown from inside a lane constructor
 * *after* a live Gemini session had already been opened for that lane. An
 * unset var and a var set to nothing are the same operator intent — "I did
 * not choose a value" — so both take the default.
 *
 * The range check exists for the same reason: every one of these values ends
 * up as an argument to something that has opinions about it, and a
 * bad one must fail here, once, at startup, rather than at the moment an
 * attendee first taps a language during a talk.
 */
function num(
  env: Env,
  key: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got ${raw}`);
  if (!Number.isInteger(n)) throw new Error(`${key} must be a whole number, got ${raw}`);
  if (n < range.min || n > range.max) {
    throw new Error(`${key} must be between ${range.min} and ${range.max}, got ${raw}`);
  }
  return n;
}

/**
 * libopus accepts far wider than this, but outside it the encoder is either
 * producing unintelligible speech or wasting an event's bandwidth on a codec
 * that cannot use it. Both ends are well inside what `OPUS_SET_BITRATE`
 * itself tolerates, so anything that passes here is guaranteed to construct.
 */
const MIN_OPUS_BITRATE = 6_000;
const MAX_OPUS_BITRATE = 510_000;

/** An hour. Past this a "grace" period is really a lane that never closes. */
const MAX_LANE_GRACE_MS = 3_600_000;

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
    // 0 is legitimate, not a mistake to reject: it asks the OS for an
    // ephemeral port. `createServer().listen()` returns the port actually
    // bound and index.ts logs it, so the value stays discoverable.
    port: num(env, "PORT", 8080, { min: 0, max: 65535 }),
    sourceLanguage,
    offeredLanguages: Object.freeze(offeredLanguages),
    maxConcurrentLanes: num(env, "MAX_CONCURRENT_LANES", 6, { min: 1, max: 64 }),
    laneGraceMs: num(env, "LANE_GRACE_MS", 60000, { min: 0, max: MAX_LANE_GRACE_MS }),
    transcriptHistoryLines: num(env, "TRANSCRIPT_HISTORY_LINES", 200, { min: 1, max: 10_000 }),
    transcriptDelayMs: num(env, "TRANSCRIPT_DELAY_MS", 0, { min: 0, max: 60_000 }),
    opusBitrate: num(env, "OPUS_BITRATE", 24000, { min: MIN_OPUS_BITRATE, max: MAX_OPUS_BITRATE }),
    // Empty is a deliberate opt-out (dev running Vite standalone in front of
    // this server), not "not configured" — unlike num()'s treatment of an
    // env var set to nothing, so `??` rather than `||` here.
    webRoot:
      env.WEB_ROOT ??
      fileURLToPath(new URL("../../web/dist", import.meta.url)),
  });
}
