import type { UiLanguage } from "../settings/ui-language.ts";

/**
 * The few strings the main process shows itself — native dialogs and the
 * errors the logo handlers throw to the renderer — which never pass through
 * i18next. A plain table rather than a second i18next instance: there are
 * nine of them, and the main process must not import the renderer's i18n
 * module (it pulls in react-i18next).
 */
export interface MainStrings {
  quitTitle: string;
  quitMessage: string;
  quitDetail: string;
  cancel: string;
  quit: string;
  restartToUpdate: string;
  logoPickTitle: string;
  logoUnsupported: (originalName: string) => string;
  logoTooLarge: (maxMb: number) => string;
}

export const MAIN_STRINGS: Record<UiLanguage, MainStrings> = {
  ko: {
    quitTitle: "통역 종료",
    quitMessage: "지금 종료하면 통역이 중단됩니다.",
    quitDetail: "듣고 있는 사람들의 소리가 모두 끊깁니다.",
    cancel: "취소",
    quit: "종료",
    restartToUpdate: "다시 시작하여 업데이트",
    logoPickTitle: "행사 로고 선택",
    logoUnsupported: (originalName) => `지원하지 않는 이미지 형식입니다: ${originalName}`,
    logoTooLarge: (maxMb) => `로고 파일이 너무 큽니다 (최대 ${maxMb}MB)`,
  },
  en: {
    quitTitle: "Stop translation",
    quitMessage: "Quitting now stops translation.",
    quitDetail: "Everyone currently listening loses audio.",
    cancel: "Cancel",
    quit: "Quit",
    restartToUpdate: "Restart to update",
    logoPickTitle: "Choose the event logo",
    logoUnsupported: (originalName) => `Unsupported image format: ${originalName}`,
    logoTooLarge: (maxMb) => `The logo file is too large (max ${maxMb}MB)`,
  },
};

export function mainStrings(lang: UiLanguage): MainStrings {
  return MAIN_STRINGS[lang];
}
