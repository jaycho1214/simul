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

export type AdminMessage = { type: "lanes"; lanes: LaneStatus[] };
