import { S } from "../strings.ts";
import { nextPreference, type Preference } from "../theme.ts";
import { AutoThemeIcon, MoonIcon, SunIcon } from "./icons.tsx";

export interface ThemeToggleProps {
  preference: Preference;
  onChange: (next: Preference) => void;
}

const LABEL: Record<"auto" | "light" | "dark", string> = {
  auto: S.themeAuto,
  light: S.themeLight,
  dark: S.themeDark,
};

/**
 * One control, three states: follow whatever the operator configured, force
 * light, force dark.
 *
 * Icon-only because the bar it sits in already carries the event's name, and
 * the state it is in is the thing the icon shows — a sun when the page is
 * light, a moon when dark, a half-filled disc when it is following the room's
 * setting. The words are the accessible name, so nothing is lost to a reader
 * who cannot see the glyph.
 */
export function ThemeToggle({ preference, onChange }: ThemeToggleProps) {
  const state = preference ?? "auto";
  const Icon = state === "light" ? SunIcon : state === "dark" ? MoonIcon : AutoThemeIcon;

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={LABEL[state]}
      onClick={() => onChange(nextPreference(preference))}
    >
      <Icon className="theme-toggle-icon" />
    </button>
  );
}
