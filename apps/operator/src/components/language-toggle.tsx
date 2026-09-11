import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ipc } from "../ipc/manager.ts";
import { applyUiLanguage } from "../localization/i18n";
import { isUiLanguage } from "../settings/ui-language.ts";

/**
 * 한국어 | English. The labels are the languages' own names on purpose: a
 * reader who cannot read the current language must still be able to find
 * the way out. Applies immediately and persists; the value shown is the
 * language actually in use, so a fresh install never shows an empty control.
 */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const current = i18n.resolvedLanguage === "en" ? "en" : "ko";

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={current}
      aria-label={t("footer.language")}
      onValueChange={(value) => {
        // Radix reports "" when the pressed item is pressed again; keep the
        // current language rather than deselecting into nothing.
        if (!isUiLanguage(value) || value === current) return;
        void (async () => {
          await applyUiLanguage(value);
          await ipc.client.settings.set({ uiLanguage: value });
          await queryClient.invalidateQueries({ queryKey: ["settings"] });
        })();
      }}
    >
      <ToggleGroupItem value="ko" aria-label="한국어" className="px-2.5 text-xs">
        한국어
      </ToggleGroupItem>
      <ToggleGroupItem value="en" aria-label="English" className="px-2.5 text-xs">
        English
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
