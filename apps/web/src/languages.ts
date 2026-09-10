import type { WebConfig } from "./config.ts";
import { ORIGINAL_TAG } from "./strings.ts";

/**
 * Each language is named in its own script, so the picker is readable by
 * someone who cannot read any of the other rows. Right-to-left scripts are out
 * of scope for v1 — adding one means adding a `dir` attribute here and in
 * LanguagePicker, not just a table entry.
 */
const ENDONYMS: Record<string, string> = {
  ko: "한국어",
  en: "English",
  es: "Español",
  ja: "日本語",
  zh: "中文",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ru: "Русский",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  th: "ไทย",
  mn: "Монгол",
  uz: "Oʻzbekcha",
};

/**
 * An operator can offer a language code we have no endonym for. Rather than
 * silently dropping a language the operator deliberately turned on, fall back
 * to the raw code, uppercased so it reads as a code (e.g. "XX") rather than a
 * word we invented.
 */
export function endonym(lang: string): string {
  return ENDONYMS[lang] ?? lang.toUpperCase();
}

export interface LanguageRow {
  lang: string;
  endonym: string;
  /** ORIGINAL_TAG for the speaker's own language, null for translations. */
  tag: string | null;
  isSource: boolean;
}

/**
 * Assumes `sourceLanguage` is a member of `offeredLanguages` — the server's
 * own config loader (`apps/server/src/config.ts`) refuses to start unless
 * `OFFERED_LANGUAGES` includes `SOURCE_LANGUAGE`, so every `/config` response
 * this client will ever see already satisfies it. `parseConfig` deliberately
 * does not re-check this: it is not part of the wire contract, just an
 * invariant the server enforces on itself. If it were ever violated anyway,
 * this function degrades safely rather than throwing — no row is tagged
 * `ORIGINAL_TAG`/`isSource: true`, but the list still renders in the server's
 * given order.
 */
export function languageRows(
  config: Pick<WebConfig, "offeredLanguages" | "sourceLanguage">,
): LanguageRow[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const lang of config.offeredLanguages) {
    if (seen.has(lang)) continue;
    seen.add(lang);
    ordered.push(lang);
  }

  // The speaker's own language leads the list; everything else keeps the
  // server's configured order.
  ordered.sort((a, b) => {
    if (a === config.sourceLanguage) return -1;
    if (b === config.sourceLanguage) return 1;
    return 0;
  });

  return ordered.map((lang) => {
    const isSource = lang === config.sourceLanguage;
    return {
      lang,
      endonym: endonym(lang),
      tag: isSource ? ORIGINAL_TAG : null,
      isSource,
    };
  });
}
