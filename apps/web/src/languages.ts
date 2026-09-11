import { findLanguage, type GeminiLanguage } from "@simul/protocol";
import type { WebConfig } from "./config.ts";
import { PASSTHROUGH_TAG, S } from "./strings.ts";

/** The server's debug passthrough lane: the room's own audio, untranslated. */
const PASSTHROUGH_ENDONYM = "원음";

/**
 * "pt-BR" is Portuguese; "zh-Hans-CN" is Chinese. A regional or script
 * subtag an operator typed by hand should still land on the row the shared
 * table has for the language itself.
 */
function baseLanguage(lang: string): string {
  return lang.split("-")[0] ?? lang;
}

function knownLanguage(lang: string): GeminiLanguage | undefined {
  return findLanguage(lang) ?? findLanguage(baseLanguage(lang));
}

/**
 * The browser's own name for a language, in that language — "Èdè Yorùbá"
 * for "yo" — for a code the table has never heard of. Undefined when the
 * browser has nothing better than the code itself, which Intl.DisplayNames
 * reports by echoing the input rather than by failing.
 */
function browserEndonym(lang: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang);
    if (!name || name.toLowerCase() === lang.toLowerCase()) return undefined;
    return name;
  } catch {
    return undefined;
  }
}

/**
 * Each language is named in its own script, so the picker is readable by
 * someone who cannot read any of the other rows. The names come from the
 * table the operator's panel is built from, so a language the engineer can
 * turn on is never a bare code on the phones — "zh-CN" reads 简体中文.
 *
 * An operator can still offer a code the table has no row for. Rather than
 * silently dropping a language the operator deliberately turned on, ask the
 * browser for its name, and failing that fall back to the raw code —
 * uppercased so it reads as a code (e.g. "XX") rather than a word we
 * invented. Right-to-left scripts are out of scope for v1 — adding one means
 * adding a `dir` attribute in LanguagePicker, not just a table entry.
 */
export function endonym(lang: string): string {
  if (lang === "original") return PASSTHROUGH_ENDONYM;
  return knownLanguage(lang)?.endonym ?? browserEndonym(lang) ?? lang.toUpperCase();
}

export interface MuteLabels {
  mute: string;
  unmute: string;
}

/**
 * The mute button's two labels in the language the reader chose, from the
 * shared table. Someone who picked 中文 finds 静音 where an English reader
 * finds Mute. For a language the table has no words for — and for the
 * passthrough lane, which is not a language — the app's usual Korean/English
 * pair, which is wrong for nobody.
 */
export function muteLabels(lang: string): MuteLabels {
  const known = knownLanguage(lang);
  if (known?.mute && known.unmute) return { mute: known.mute, unmute: known.unmute };
  return { mute: S.mute, unmute: S.unmute };
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
