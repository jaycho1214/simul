import type {
  AdminMessage,
  LaneState,
  LaneStatus,
  LanguageUsage,
  UsageReport,
} from "@simul/protocol";

const LANE_STATES: readonly LaneState[] = ["starting", "live", "reconnecting", "error"];

function toText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }
  return undefined;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toLaneStatus(value: unknown): LaneStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const lane = value as Record<string, unknown>;

  if (typeof lane.lang !== "string" || lane.lang.length === 0) return undefined;
  if (typeof lane.state !== "string") return undefined;
  if (!LANE_STATES.includes(lane.state as LaneState)) return undefined;

  return {
    lang: lane.lang,
    listeners: toCount(lane.listeners),
    // Added to LaneStatus during a server fix wave after this task was
    // drafted: it is the figure that falls when someone mutes, where
    // `listeners` (max of audio and transcript subscriptions) does not.
    // Coerced the same as the other counters so a short/old payload degrades
    // to "no audio reported" instead of throwing.
    audioListeners: toCount(lane.audioListeners),
    state: lane.state as LaneState,
    laneDrops: toCount(lane.laneDrops),
    listenerDrops: toCount(lane.listenerDrops),
    ageMs: toCount(lane.ageMs),
  };
}

function toLanguageUsage(value: unknown): LanguageUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.lang !== "string" || row.lang.length === 0) return undefined;
  if (typeof row.inputAudioTokens !== "number" || typeof row.outputAudioTokens !== "number") {
    return undefined;
  }
  return {
    lang: row.lang,
    inputAudioTokens: toCount(row.inputAudioTokens),
    outputAudioTokens: toCount(row.outputAudioTokens),
  };
}

/**
 * The meter is money, so a report is all-or-nothing: a row that does not
 * parse discards the whole report for this frame rather than showing a total
 * that is quietly short by one language. The lane table is unaffected.
 */
function toUsageReport(value: unknown): UsageReport | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const report = value as Record<string, unknown>;
  if (typeof report.since !== "number" || !Array.isArray(report.languages)) return undefined;
  const languages = report.languages.map(toLanguageUsage);
  if (languages.some((row) => row === undefined)) return undefined;
  return { since: report.since, languages: languages as LanguageUsage[] };
}

/**
 * The dashboard is watched during a live event. A payload that is malformed for
 * one second must not blank the table or crash the renderer, so anything that
 * does not parse cleanly is discarded and the previous table is kept.
 */
export function parseAdminMessage(raw: unknown): AdminMessage | undefined {
  const text = toText(raw);
  if (text === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;
  const message = parsed as Record<string, unknown>;
  if (message.type !== "lanes" || !Array.isArray(message.lanes)) return undefined;

  const lanes = message.lanes
    .map(toLaneStatus)
    .filter((lane): lane is LaneStatus => lane !== undefined);

  const usage = toUsageReport(message.usage);
  return usage ? { type: "lanes", lanes, usage } : { type: "lanes", lanes };
}
