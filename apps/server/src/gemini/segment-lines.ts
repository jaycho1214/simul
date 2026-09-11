/**
 * Where a running transcription can be cut into lines.
 *
 * `gemini-3.5-live-translate-preview` streams its output transcription as
 * fragments — "Hello. Today", " we're going to talk", " about a real-time",
 * " system." — and never marks an end: measured 2026-09-11 against the real
 * API, no `outputTranscription.finished` and no `turnComplete` arrived across
 * two sentences, a 45 s pause between them, and 20 s of silence after. The
 * model "translates as the speaker talks without waiting for turns", so
 * there is no turn for either flag to close. Left to those flags, the
 * attendee's transcript was one line that grew for the whole event and never
 * scrolled up.
 *
 * So the line breaks are decided here, from the text itself: a sentence is
 * complete once its terminator has been followed by whitespace. Waiting for
 * the whitespace, rather than cutting at the terminator, is what keeps
 * "3.5 million" and "e.g." from splitting — a full stop inside a token is
 * never followed by a space. The full-width terminators of Chinese and
 * Japanese carry no such ambiguity and end a sentence on their own, with or
 * without anything after them. Closing quotes and brackets stay with the
 * sentence they close.
 *
 * The tail — whatever follows the last cut — is still being written. It is
 * committed by the caller on a pause (see `GeminiTranslateSession`), which is
 * also what commits speech in a language that writes no terminators at all.
 */
const SENTENCE_END = /[.!?…]+[)\]"'”’」』]*\s+|[。！？]+[)\]"'”’」』]*/gu;

export function splitCompleteSentences(text: string): { done: string[]; rest: string } {
  const done: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) done.push(sentence);
    start = end;
  }
  return { done, rest: text.slice(start) };
}
