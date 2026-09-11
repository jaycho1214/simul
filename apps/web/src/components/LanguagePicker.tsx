import type { Brand } from "../config.ts";
import type { LanguageRow } from "../languages.ts";
import { S, bilingual } from "../strings.ts";
import type { Preference } from "../theme.ts";
import { Bilingual } from "./Bilingual.tsx";
import { BrandBar } from "./BrandBar.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export interface LanguagePickerProps {
  brand: Brand;
  /**
   * Whether the operator has started. Rows are inert until they have: a tap
   * opens a Gemini session, and one opened against an empty room bills for
   * translating silence.
   */
  live: boolean;
  preference: Preference;
  onPreferenceChange: (next: Preference) => void;
  rows: LanguageRow[];
  /**
   * Called synchronously from the click handler. The caller starts audio inside
   * this call — an `await` before `element.play()` loses the user gesture and
   * iOS silently refuses to play.
   */
  onPick: (lang: string) => void;
}

/**
 * The whole screen is the list. The instruction is demoted to a quiet label
 * and the endonyms are set at display size, because the one thing this screen
 * asks of a reader is to find their own language in a script they recognise —
 * and the fastest way to do that is to make the words large enough to pick out
 * at a glance in a dim hall.
 *
 * There is deliberately no chevron on each row. The affordance is the size of
 * the target, the press state, and the instruction above them; a row of
 * disclosure arrows turns this back into the settings list it used to be.
 */
export function LanguagePicker({
  brand,
  live,
  preference,
  onPreferenceChange,
  rows,
  onPick,
}: LanguagePickerProps) {
  // Stacked rather than joined with " / ": a slash reads fine in a status line
  // and is an accident in a headline.
  const prompt = bilingual(S.pickLanguage);
  const waiting = bilingual(S.notStarted);

  return (
    <main className="picker">
      <BrandBar
        brand={brand}
        trailing={<ThemeToggle preference={preference} onChange={onPreferenceChange} />}
      />

      <div className="picker-head">
        <h1 className="picker-prompt">
          {live ? prompt.ko : waiting.ko}
          <span className="picker-prompt-en">{live ? prompt.en : waiting.en}</span>
        </h1>
        {/*
         * Said once, above the list, rather than repeated on every disabled
         * row. The rows stay visible so an early arrival can see their
         * language is coming — they simply cannot open a lane yet.
         */}
        {!live ? (
          <p className="picker-waiting">
            <Bilingual text={S.notStartedBody} />
          </p>
        ) : null}
      </div>

      <ul className="picker-rows">
        {rows.map((row) => (
          <li key={row.lang}>
            <button
              type="button"
              className={row.isPassthrough ? "picker-row picker-row--passthrough" : "picker-row"}
              // Inert until the operator starts. A tap opens a lane, and a
              // lane opened against an empty room bills for translating
              // silence.
              disabled={!live}
              onClick={() => onPick(row.lang)}
            >
              <span className="picker-endonym" lang={row.lang}>
                {row.endonym}
              </span>
              {row.tag ? <span className="picker-tag">{row.tag}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
