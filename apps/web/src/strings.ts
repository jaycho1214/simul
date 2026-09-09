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

  waitingForSpeech: "말씀을 기다리는 중 / Waiting for the speaker",
  configError: "서버에 연결할 수 없습니다 / Cannot reach the server",
  retry: "다시 시도 / Retry",
} as const;

/**
 * The picker's tag for the speaker's own language, written exactly as the spec
 * shows it: `한국어  (원음 · Original)`. A middle dot, not a slash.
 */
export const ORIGINAL_TAG = "원음 · Original";
