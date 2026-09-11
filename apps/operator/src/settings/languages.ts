import { GEMINI_LANGUAGES } from "@simul/protocol";

// The table itself lives in the protocol package so the attendee page names
// the same languages the engineer turned on; this module keeps what only the
// operator needs.
export { GEMINI_LANGUAGES, findLanguage, type GeminiLanguage } from "@simul/protocol";

/**
 * A shape check, not a membership check. The panel lets an engineer type a
 * code this list is missing, so this is the only thing standing between a
 * typo and a lane the server cannot open — but it cannot know whether Google
 * supports the code, only whether it looks like BCP-47 at all.
 */
export function isLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(value);
}

const BY_CODE = new Map(GEMINI_LANGUAGES.map((l) => [l.code, l]));

/** Both names for a code the list knows; the bare code for one it does not. */
export function languageLabel(code: string): string {
  const known = BY_CODE.get(code);
  return known ? `${known.endonym} · ${known.ko}` : code;
}

/**
 * The languages the running server still serves that the saved list no
 * longer carries. Adding is live (the server offers a new language as soon
 * as it is pushed), but removing is a restart by design — so between the
 * click and the restart, these are what the panel must keep showing, marked
 * as on their way out, or the engineer would read the list as already done.
 * Empty when the server is not running: the saved list is then the boot list.
 */
export function languagesPendingRemoval(
  saved: readonly string[],
  served: readonly string[] | undefined,
): string[] {
  return (served ?? []).filter((code) => !saved.includes(code));
}
