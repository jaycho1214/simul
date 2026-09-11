import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Panel } from "@/components/ui/panel";
import { cn } from "@/utils/tailwind";
import { GEMINI_LANGUAGES, findLanguage, isLanguageCode } from "../../settings/languages.ts";
import { ipc } from "../../ipc/manager.ts";

/**
 * Which languages the event offers.
 *
 * There is no source language to choose. `translationConfig` takes only
 * `targetLanguageCode`; the model detects the input language itself and, with
 * echo on, parrots speech that is already in the target language — so an
 * English listener hears English whether the speaker is translating from
 * Korean or simply speaking English. Every language here is a translation lane.
 * The only untranslated lane is the passthrough at the bottom, a debugging aid
 * for checking the capture chain, which is why it is a plain checkbox and off
 * by default.
 *
 * Unlike the brand, this cannot be applied live — lanes and their encoders are
 * built from the language list when the server boots, and swapping the list
 * under a lane that phones are listening to is not something to do mid-service.
 * So the panel says plainly that it needs a restart and leaves the timing to
 * the engineer.
 */
export function LanguagePanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => ipc.client.settings.get(),
  });

  const offered = settings.data?.offeredLanguages ?? [];
  const passthrough = settings.data?.passthroughLane ?? false;

  async function patch(next: Parameters<typeof ipc.client.settings.set>[0]) {
    await ipc.client.settings.set(next);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  function toggle(code: string) {
    const next = offered.includes(code) ? offered.filter((c) => c !== code) : [...offered, code];
    void patch({ offeredLanguages: next });
  }

  const typedIsValid = isLanguageCode(typed.trim());
  const typedIsNew = typedIsValid && !offered.includes(typed.trim());

  function addTyped() {
    if (!typedIsNew) return;
    void patch({ offeredLanguages: [...offered, typed.trim()] });
    setTyped("");
  }

  // Anything the operator added by hand that the curated list does not carry.
  const extras = offered.filter((code) => !findLanguage(code));

  return (
    <Panel title={t("lang.title")}>
      <p className="max-w-3xl text-xs leading-snug text-muted-foreground">{t("lang.autoDetect")}</p>

      <div className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{t("lang.offered")}</span>
          <span className="text-xs text-muted-foreground">
            {t("lang.count", { n: offered.length })}
          </span>
        </div>

        <div className="flex max-w-3xl flex-wrap gap-1.5">
          {GEMINI_LANGUAGES.map((lang) => {
            const on = offered.includes(lang.code);
            return (
              <button
                key={lang.code}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(lang.code)}
                title={lang.ko}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                  on
                    ? "border-live/40 bg-live/12 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{lang.endonym}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{lang.code}</span>
              </button>
            );
          })}
        </div>

        {extras.length > 0 ? (
          <div className="flex max-w-3xl flex-wrap gap-1.5">
            {extras.map((code) => (
              <span
                key={code}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-live/40 bg-live/12 px-3 text-sm"
              >
                <span className="font-mono">{code}</span>
                <button
                  type="button"
                  aria-label={t("lang.remove", { code })}
                  onClick={() => toggle(code)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/*
       * The curated list above is a best effort: Google documents "over 70"
       * supported BCP-47 codes but does not publish the table in a form this
       * app can carry, so an engineer must never be blocked by something
       * missing from it.
       */}
      <div className="grid max-w-sm gap-1.5">
        <label className="text-sm font-medium" htmlFor="custom-language">
          {t("lang.addCode")}
        </label>
        <div className="flex gap-2">
          <Input
            id="custom-language"
            className="min-w-0 flex-1 font-mono"
            placeholder="pt-BR"
            value={typed}
            aria-invalid={typed.trim() !== "" && !typedIsValid}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTyped();
            }}
          />
          <Button
            variant="secondary"
            className="h-9 px-3 text-sm"
            disabled={!typedIsNew}
            onClick={addTyped}
          >
            <Plus data-icon="inline-start" />
            {t("lang.add")}
          </Button>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{t("lang.addHint")}</p>
      </div>

      <label className="flex max-w-3xl items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={passthrough}
          onChange={(e) => void patch({ passthroughLane: e.target.checked })}
        />
        <span className="grid gap-1">
          <span className="font-medium">{t("lang.passthrough")}</span>
          <span className="text-xs leading-snug text-muted-foreground">
            {t("lang.passthroughHint")}
          </span>
        </span>
      </label>

      <Notice tone="warn">{t("lang.restartNeeded")}</Notice>
    </Panel>
  );
}
