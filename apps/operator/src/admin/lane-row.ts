import type { LaneStatus } from "@tongyeok/protocol";

/**
 * Endonyms, matching the attendee picker. A lane is shown in its own script so
 * the engineer and the attendee are looking at the same word.
 */
const ENDONYM: Record<string, string> = {
  ko: "한국어",
  en: "English",
  es: "Español",
  ja: "日本語",
  original: "원음",
  zh: "中文",
  fr: "Français",
  de: "Deutsch",
  vi: "Tiếng Việt",
  th: "ไทย",
  id: "Bahasa Indonesia",
};

export interface LaneRow {
  lang: string;
  /** 언어 */
  label: string;
  /** 청취자 수 */
  listeners: number;
  /**
   * Of `listeners`, how many are pulling audio right now. This is the figure
   * that moves when somebody mutes — `listeners` (max of audio and transcript
   * subscriptions) holds steady across a mute, so it alone would make muting
   * invisible to the operator. Rendered alongside `listeners`, never instead
   * of it.
   */
  audioListeners: number;
  /** 상태 — is the lane carrying anyone right now */
  openKey: "laneOpen.open" | "laneOpen.waiting" | "laneOpen.error";
  /** 세션 상태 — what the Gemini session reports */
  sessionKey: `laneState.${LaneStatus["state"]}`;
  /** 레인 드롭 */
  laneDrops: number;
  /** 청취자 드롭 */
  listenerDrops: number;
  /** Any of: dropping frames, or not currently live. Drives the row highlight. */
  degraded: boolean;
}

/**
 * The spec's table has both 상태 and 세션 상태. They answer different questions:
 * 상태 is "is anyone on this lane", 세션 상태 is "is the translation session
 * healthy". A lane can be 열림 while 재연결 중, and 대기 while 실행 중 during the
 * server's 60 s grace period.
 */
export function toLaneRow(status: LaneStatus): LaneRow {
  const openKey =
    status.state === "error"
      ? "laneOpen.error"
      : status.listeners > 0
        ? "laneOpen.open"
        : "laneOpen.waiting";

  return {
    lang: status.lang,
    label: ENDONYM[status.lang] ?? status.lang,
    listeners: status.listeners,
    audioListeners: status.audioListeners,
    openKey,
    sessionKey: `laneState.${status.state}`,
    laneDrops: status.laneDrops,
    listenerDrops: status.listenerDrops,
    degraded: status.laneDrops > 0 || status.listenerDrops > 0 || status.state !== "live",
  };
}

/**
 * The operator app never opens /listen, so every listener the server reports is
 * a device that reached the laptop over the LAN. That makes this the only
 * reachability signal in the app that is proof rather than inference. Presence
 * (`listeners`), not audio flow (`audioListeners`), is what proves it — a
 * muted attendee is still a connected phone.
 */
export function anyExternalListener(lanes: readonly LaneStatus[]): boolean {
  return lanes.some((lane) => lane.listeners > 0);
}
