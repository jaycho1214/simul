import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Panel } from "@/components/ui/panel";
import { cn } from "@/utils/tailwind";
import {
  GEMINI_LANGUAGES,
  findLanguage,
  isLanguageCode,
  languagesPendingRemoval,
} from "../../settings/languages.ts";
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
 * Adding applies live: every save pushes the list to the running server,
 * which offers whatever is new from its next /config, and a phone on the
 * picker re-reads that every few seconds. Removing does not — pulling a lane
 * out from under phones listening to it is not something to do mid-service —
 * so the server keeps serving a removed language until it restarts. The
 * panel shows exactly that state: a removed-but-still-served language stays
 * on screen, struck through, until the restart the notice asks for.
 */
export function LanguagePanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => ipc.client.settings.get(),
  });
  const server = useQuery({
    queryKey: ["serverStatus"],
    queryFn: () => ipc.client.server.status(),
    refetchInterval: 1000,
  });

  const offered = settings.data?.offeredLanguages ?? [];
  const passthrough = settings.data?.passthroughLane ?? false;
  // What the server itself says it serves — its report, not what was pushed.
  const served = server.data?.offered;
  const pendingRemoval = languagesPendingRemoval(offered, served?.languages);
  const passthroughPendingOff = served?.passthroughLane === true && !passthrough;
  const needsRestart = pendingRemoval.length > 0 || passthroughPendingOff;

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

  // Anything the operator added by hand that the curated list does not carry
  // — including one they have since removed but the server still serves.
  const extras = [...offered, ...pendingRemoval].filter((code) => !findLanguage(code));

  return (
    <Panel title={t("lang.title")}>
      <p className="max-w-3xl text-xs leading-snug text-muted-foreground">{t("lang.autoDetect")}</p>
      {/*
       * The default list includes 한국어, and the speaker at most of this app's
       * events speaks Korean. With echo on, that lane costs a Gemini session
       * to say nothing new, so the one language worth removing is called out
       * next to the list rather than left to be discovered on the bill.
       */}
      <Notice tone="warn">{t("lang.speakerLanguage")}</Notice>

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
            const leaving = pendingRemoval.includes(lang.code);
            return (
              <button
                key={lang.code}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(lang.code)}
                title={leaving ? t("lang.pendingRemoval") : lang.ko}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                  on
                    ? "border-live/40 bg-live/12 text-foreground"
                    : leaving
                      ? "border-warn/50 bg-warn/10 text-muted-foreground line-through"
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
            {extras.map((code) => {
              const leaving = pendingRemoval.includes(code);
              return (
                <span
                  key={code}
                  title={leaving ? t("lang.pendingRemoval") : undefined}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm",
                    leaving
                      ? "border-warn/50 bg-warn/10 text-muted-foreground line-through"
                      : "border-live/40 bg-live/12",
                  )}
                >
                  <span className="font-mono">{code}</span>
                  {leaving ? (
                    <button
                      type="button"
                      aria-label={t("lang.restore", { code })}
                      onClick={() => toggle(code)}
                      className="text-muted-foreground no-underline hover:text-foreground"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={t("lang.remove", { code })}
                      onClick={() => toggle(code)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </span>
              );
            })}
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
          <span className="font-medium">
            {t("lang.passthrough")}
            {passthroughPendingOff ? (
              <span className="ml-2 text-xs font-normal text-warn">{t("lang.pendingRemoval")}</span>
            ) : null}
          </span>
          <span className="text-xs leading-snug text-muted-foreground">
            {t("lang.passthroughHint")}
          </span>
        </span>
      </label>

      {/*
       * Only a removal earns the warning. An addition is on the phones within
       * a poll and there is nothing to warn about; the muted line says so, so
       * an engineer does not go looking for an apply button.
       */}
      {needsRestart ? (
        <Notice tone="warn">
          {t("lang.removalNeedsRestart", {
            codes: [
              ...pendingRemoval,
              ...(passthroughPendingOff ? [t("lang.passthrough")] : []),
            ].join(", "),
          })}
        </Notice>
      ) : (
        <p className="max-w-3xl text-xs leading-snug text-muted-foreground">{t("lang.liveHint")}</p>
      )}
    </Panel>
  );
}
