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
  listeners: number;
  state: LaneState;
  laneDrops: number;
  listenerDrops: number;
  ageMs: number;
}

export type AdminMessage = { type: "lanes"; lanes: LaneStatus[] };
