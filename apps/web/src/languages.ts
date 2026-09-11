import type { WebConfig } from "./config.ts";
import { PASSTHROUGH_TAG } from "./strings.ts";

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
  /** The server's debug passthrough lane: the room's own audio, untranslated. */
  original: "원음",
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
  /** PASSTHROUGH_TAG on the debug lane, null on every translation. */
  tag: string | null;
  isPassthrough: boolean;
}

/**
 * The offered languages in the server's configured order, then — only when
 * the operator has turned it on — the untranslated passthrough lane, last and
 * tagged as debug. There is no "speaker's own language" row: every language
 * is a translation, and the model works out what is being spoken. Duplicate
 * codes are dropped so a doubled entry in the server's list cannot produce two
 * identical rows.
 */
export function languageRows(
  config: Pick<WebConfig, "offeredLanguages" | "passthroughLanguage">,
): LanguageRow[] {
  const seen = new Set<string>();
  const rows: LanguageRow[] = [];

  for (const lang of config.offeredLanguages) {
    if (seen.has(lang)) continue;
    seen.add(lang);
    rows.push({ lang, endonym: endonym(lang), tag: null, isPassthrough: false });
  }

  const passthrough = config.passthroughLanguage;
  if (passthrough && !seen.has(passthrough)) {
    rows.push({
      lang: passthrough,
      endonym: endonym(passthrough),
      tag: PASSTHROUGH_TAG,
      isPassthrough: true,
    });
  }

  return rows;
}
