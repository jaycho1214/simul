import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { UiLanguage } from "../settings/ui-language.ts";
import { EN_STRINGS } from "./locales/en.ts";
import { KO_STRINGS } from "./locales/ko.ts";

export { KO_STRINGS } from "./locales/ko.ts";
export { EN_STRINGS } from "./locales/en.ts";

/**
 * Two locales, Korean as the fallback: it is the hand-checked reference table,
 * so a key that ever went missing in English shows Korean rather than a raw
 * key. The active language is set by applyUiLanguage() once settings are
 * known (app.tsx), and again whenever the rail's toggle changes it.
 */
void i18n.use(initReactI18next).init({
  lng: "ko",
  fallbackLng: "ko",
  supportedLngs: ["ko", "en"],
  interpolation: { escapeValue: false },
  resources: {
    ko: { translation: KO_STRINGS },
    en: { translation: EN_STRINGS },
  },
});

/** Switches every mounted t() and the document's lang attribute together. */
export async function applyUiLanguage(lang: UiLanguage): Promise<void> {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  await i18n.changeLanguage(lang);
}

export default i18n;
