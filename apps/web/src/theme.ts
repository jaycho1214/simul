import type { Theme } from "./config.ts";

/**
 * The reader's own light/dark choice, when they have made one.
 *
 * `null` means "whatever the operator configured" — which is the default, and
 * the state the control returns to. A reader who overrides it is saying
 * something about this phone in this room (a bright foyer, a dim hall, their
 * own eyes), not about the event, so the choice lives on the device and never
 * reaches the server.
 */
export type Preference = "light" | "dark" | null;

export const PREFERENCE_KEY = "simul.theme";

const VALID = ["light", "dark"] as const;

/**
 * Every access is guarded. A phone in the hall can be in a private window,
 * have site data blocked, or be out of quota — in some of those the accessor
 * itself throws — and none of them is a reason for the page not to render.
 * A failure just means the reader has no stored preference.
 */
export function readPreference(): Preference {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEY);
    return VALID.includes(stored as "light" | "dark") ? (stored as Preference) : null;
  } catch {
    return null;
  }
}

export function writePreference(preference: Preference): void {
  try {
    if (preference === null) localStorage.removeItem(PREFERENCE_KEY);
    else localStorage.setItem(PREFERENCE_KEY, preference);
  } catch {
    // The choice still applies for this page view; it just will not survive a
    // reload. Better than refusing to switch at all.
  }
}

/** One control, three states: follow the operator, force light, force dark. */
export function nextPreference(current: Preference): Preference {
  if (current === null) return "light";
  if (current === "light") return "dark";
  return null;
}

/** The label for whichever state the control is in. */
export function preferenceTheme(preference: Preference): Theme | null {
  return preference;
}
