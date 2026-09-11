import type { AudioUsage, LanguageUsage } from "@simul/protocol";

/**
 * Paid-tier list prices for `gemini-3.5-live-translate-preview`, USD per
 * million audio tokens, from https://ai.google.dev/gemini-api/docs/pricing
 * as of 2026-09-11. Output is six times input, which is why a lane costs
 * roughly what it costs whether or not anyone is speaking: the model returns
 * a continuous stream, silence included.
 *
 * These are copied, not fetched: the Gemini API has no endpoint that reports
 * a key's spend or prices, and the venue laptop should not need one at the
 * sound desk. When Google changes the list, this is the line to change, and
 * the panel already says the figure is an estimate.
 */
export const USD_PER_MILLION_INPUT_AUDIO_TOKENS = 3.5;
export const USD_PER_MILLION_OUTPUT_AUDIO_TOKENS = 21;

/** Where the real bill is. The app links here rather than pretending to know it. */
export const AI_STUDIO_USAGE_URL = "https://aistudio.google.com/usage";

export function estimateUsd(usage: AudioUsage): number {
  return (
    (usage.inputAudioTokens / 1_000_000) * USD_PER_MILLION_INPUT_AUDIO_TOKENS +
    (usage.outputAudioTokens / 1_000_000) * USD_PER_MILLION_OUTPUT_AUDIO_TOKENS
  );
}

export function sumUsage(languages: readonly LanguageUsage[]): AudioUsage {
  let inputAudioTokens = 0;
  let outputAudioTokens = 0;
  for (const row of languages) {
    inputAudioTokens += row.inputAudioTokens;
    outputAudioTokens += row.outputAudioTokens;
  }
  return { inputAudioTokens, outputAudioTokens };
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(amount: number): string {
  return usd.format(amount);
}
