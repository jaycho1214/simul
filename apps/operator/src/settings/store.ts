import { app } from "electron";
import Store from "electron-store";
import { normalizeSettings, type OperatorSettings } from "./schema.ts";
import { resolveUiLanguage, type UiLanguage } from "./ui-language.ts";

/**
 * One flat record, normalised on every read. electron-store's own schema
 * validation is deliberately not used: it throws on a mismatch, and a settings
 * file that a previous build wrote must degrade to defaults rather than stop the
 * app from starting.
 */
const store = new Store<{ settings: unknown }>({ name: "simul-operator" });

export function getSettings(): OperatorSettings {
  const settings = normalizeSettings(store.get("settings"));
  // Persist the generated ingest token on first run so it survives a restart.
  store.set("settings", settings);
  return settings;
}

export function updateSettings(patch: Partial<OperatorSettings>): OperatorSettings {
  const next = normalizeSettings({ ...getSettings(), ...patch });
  store.set("settings", next);
  return next;
}

/**
 * The language for anything the main process shows itself. Read at the moment
 * of use, never cached: the rail's toggle writes the setting and the very next
 * dialog must already follow it.
 */
export function uiLanguageForMain(): UiLanguage {
  return resolveUiLanguage(getSettings().uiLanguage, app.getLocale());
}
