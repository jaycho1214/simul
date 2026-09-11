export type LangCode = string;

export type LaneState = "starting" | "live" | "reconnecting" | "error";

export interface TranscriptLine {
  readonly seq: number;
  readonly text: string;
  readonly isFinal: boolean;
  readonly ts: number;
}

export type ServerMessage =
  | { type: "hello"; lang: LangCode; historyLines: number }
  | { type: "history"; lines: TranscriptLine[] }
  | { type: "transcript"; line: TranscriptLine }
  | { type: "lane"; state: LaneState }
  | { type: "error"; code: "lane_cap" | "unknown_language"; message: string };

export interface LaneStatus {
  lang: LangCode;
  /**
   * How many people are on this lane, as opposed to how many sockets are.
   *
   * One attendee's phone holds two subscriptions to the same lane at once:
   * the chunked `/stream/<lang>.webm` response carrying the audio, and the
   * `/listen` WebSocket carrying the transcript. Counting subscriptions
   * reported three attendees as six, and dropped to five the moment one of
   * them muted — a figure the operator cannot act on, because it does not
   * correspond to anything in the room.
   *
   * Nobody holds more than one subscription of either kind, so the larger of
   * the two counts is the tightest bound on the head count that never
   * double-counts anyone. It is exact whenever attendees use the web app as
   * designed — both transports, so both counts equal the head count — and it
   * holds steady when someone mutes. It under-reports only in the mixed case
   * where some people hold audio alone (a bare `/stream` URL in a media
   * player) while different people hold transcript alone; `audioListeners`
   * is published alongside it so that case is visible rather than hidden.
   */
  listeners: number;
  /** Of those, how many are pulling audio right now. Falls when people mute. */
  audioListeners: number;
  state: LaneState;
  laneDrops: number;
  listenerDrops: number;
  ageMs: number;
}

/**
 * What Gemini has charged for, in the unit it bills: audio tokens, in and
 * out. Counted from the `usageMetadata` the Live API sends about once a
 * second — 25 tokens per second of speech either way — so this is Google's
 * own tally, not an estimate from bytes.
 */
export interface AudioUsage {
  inputAudioTokens: number;
  outputAudioTokens: number;
}

export interface LanguageUsage extends AudioUsage {
  lang: LangCode;
}

/**
 * The bill so far for this server process, per language, across every lane
 * that has been open — including ones that have since closed. Only the
 * price list is missing, which the operator app carries.
 */
export interface UsageReport {
  /** Epoch ms when the server started counting: its own start. */
  since: number;
  languages: LanguageUsage[];
}

export type AdminMessage = {
  type: "lanes";
  lanes: LaneStatus[];
  /** Absent from an older server; the operator app shows nothing then. */
  usage?: UsageReport;
};
