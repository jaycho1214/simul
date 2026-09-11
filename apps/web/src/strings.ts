/**
 * The single source of user-visible text. All chrome is Korean and English
 * together, in that order, separated by " / " — one table, no per-language
 * locales, because the reader's language is the thing being translated, not the
 * thing the UI is written in.
 */
export const S = {
  appTitle: "실시간 통역 / Live Translation",
  pickLanguage: "언어를 선택하세요 / Choose your language",
  changeLanguage: "언어 변경 / Change language",
  /** The compact form, for the listen screen's bar where the full label does
   *  not fit beside the event's name. */
  changeShort: "변경 / Change",

  mute: "음소거 / Mute",
  unmute: "소리 켜기 / Unmute",

  silentSwitchTitle: "소리가 안 들리나요? / No sound?",
  silentSwitchBody:
    "아이폰 옆면의 무음 스위치를 꺼주세요. / Turn off the silent switch on the side of your iPhone.",

  connecting: "연결 중 / Connecting",
  starting: "시작하는 중 / Starting",
  live: "실시간 / Live",
  reconnecting: "재연결 중 / Reconnecting",
  audioStalled: "오디오 재연결 중 / Reconnecting audio",
  tapToPlay: "화면을 눌러 소리를 켜세요 / Tap to start the sound",

  laneError: "이 언어에 문제가 있습니다 / This language has a problem",
  laneCap:
    "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now",
  unknownLanguage: "알 수 없는 언어입니다 / Unknown language",

  notStarted: "아직 시작 전입니다 / Not started yet",
  notStartedBody:
    "행사가 시작되면 언어를 고를 수 있습니다 / You can choose a language once the event begins",

  themeAuto: "화면 자동 / Match device",
  themeLight: "밝게 / Light",
  themeDark: "어둡게 / Dark",

  waitingForSpeech: "말씀을 기다리는 중 / Waiting for the speaker",
  configError: "서버에 연결할 수 없습니다 / Cannot reach the server",
  retry: "다시 시도 / Retry",
} as const;

/**
 * The picker's tag on the untranslated passthrough lane, which the operator
 * turns on only to check the audio chain. A middle dot rather than the " / "
 * divider on purpose: it is one label, not a Korean/English pair.
 */
export const PASSTHROUGH_TAG = "Original · debug";

export interface Bilingual {
  ko: string;
  en: string;
}

/**
 * Splits a table entry on the documented " / " divider. The table itself stays
 * the single source of truth — this only changes how a string is set, never
 * what it says — so a caller that needs the two halves on separate lines does
 * not become a reason to keep the same sentence written down twice.
 *
 * A string with no divider comes back whole in `ko`, which is the safe way to
 * fail: the reader sees the full text rather than half of it.
 */
export function bilingual(text: string): Bilingual {
  const at = text.indexOf(" / ");
  if (at === -1) return { ko: text, en: "" };
  return { ko: text.slice(0, at), en: text.slice(at + 3) };
}
