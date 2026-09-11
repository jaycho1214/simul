import { bilingual } from "../strings.ts";

export interface BilingualProps {
  /** An entry from the string table, in its joined "한국어 / English" form. */
  text: string;
  className?: string;
}

/**
 * A table entry set as two lines instead of one.
 *
 * The joined form is right for a status line, where the slash reads as a
 * separator between two short labels. Set as a sentence it is an accident:
 * the divider lands wherever the line happens to wrap, and a reader scanning
 * for their own language has to find where one ends and the other begins.
 *
 * The table stays the single source of truth — this only changes how a string
 * is set, never what it says.
 */
export function Bilingual({ text, className }: BilingualProps) {
  const { ko, en } = bilingual(text);
  return (
    <span className={className}>
      {ko}
      <span className="bilingual-en">{en}</span>
    </span>
  );
}
