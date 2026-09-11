/**
 * The operator window's own language — not the languages offered to the room,
 * which are `offeredLanguages`. Kept apart from schema.ts because the renderer
 * resolves it too, and schema.ts pulls in node:crypto, which a renderer module
 * must never reach (see renderer-imports.test.ts).
 */
export const UI_LANGUAGES = ["ko", "en"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (UI_LANGUAGES as readonly string[]).includes(value);
}

/**
 * `null` is "follow the machine": a Korean OS gets Korean, anything else gets
 * English. An explicit choice always wins, so an engineer who flipped the
 * toggle once on an English Windows laptop keeps Korean on every launch.
 */
export function resolveUiLanguage(setting: UiLanguage | null, osLocale: string): UiLanguage {
  if (setting) return setting;
  return osLocale.trim().toLowerCase().startsWith("ko") ? "ko" : "en";
}
