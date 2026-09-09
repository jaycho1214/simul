import type { LanguageRow } from "../languages.ts";
import { S } from "../strings.ts";

export interface LanguagePickerProps {
  rows: LanguageRow[];
  /**
   * Called synchronously from the click handler. The caller starts audio inside
   * this call — an `await` before `element.play()` loses the user gesture and
   * iOS silently refuses to play.
   */
  onPick: (lang: string) => void;
}

export function LanguagePicker({ rows, onPick }: LanguagePickerProps) {
  return (
    <main className="picker">
      <h1 className="picker-title">{S.appTitle}</h1>
      <p className="picker-prompt">{S.pickLanguage}</p>

      <ul className="picker-rows">
        {rows.map((row) => (
          <li key={row.lang}>
            <button
              type="button"
              className="picker-row"
              onClick={() => onPick(row.lang)}
            >
              <span className="picker-endonym" lang={row.lang}>
                {row.endonym}
              </span>
              {row.tag ? (
                <span className="picker-tag">{`(${row.tag})`}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
