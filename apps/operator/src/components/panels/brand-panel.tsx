import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Notice, Panel, SpecRow, SpecRows } from "@/components/ui/panel";
import { cn } from "@/utils/tailwind";
import { normalizeAccent, type BrandTheme } from "../../settings/brand.ts";
import { ipc } from "../../ipc/manager.ts";

/** The last path segment, the only part of a stored logo path worth showing. */
function basename(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}

/**
 * What the attendee app wears: the event's name, one accent colour, a logo and
 * a light/dark choice.
 *
 * All four reach the running server the moment they are saved — no restart, so
 * fixing a misspelled event name does not drop every phone in the room. Phones
 * already listening keep what they loaded with until they refresh; new arrivals
 * get the change immediately.
 *
 * The accent is the only field that can be wrong, so it is the only one that
 * validates as you type: the server refuses to boot on a colour it cannot
 * parse, and catching it here means finding out while a panel is still open.
 */
export function BrandPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => ipc.client.settings.get(),
  });
  const preview = useQuery({
    queryKey: ["brandLogoPreview", settings.data?.brandLogoPath],
    queryFn: () => ipc.client.settings.brandLogoPreview(),
  });

  const saved = settings.data;

  useEffect(() => {
    if (saved && accentDraft === null) setAccentDraft(saved.brandAccent ?? "");
  }, [saved, accentDraft]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
    await queryClient.invalidateQueries({ queryKey: ["brandLogoPreview"] });
  }

  async function patch(next: Parameters<typeof ipc.client.settings.set>[0]) {
    await ipc.client.settings.set(next);
    await refresh();
  }

  const draft = accentDraft ?? "";
  const parsedAccent = normalizeAccent(draft);
  const accentInvalid = draft.trim() !== "" && parsedAccent === null;

  /**
   * Reads the dropped file in the renderer and sends its bytes. Electron no
   * longer exposes File.path under context isolation, and bytes work the same
   * whether the file came from Finder, a browser, or a chat download.
   */
  async function acceptFile(file: File) {
    setLogoError(null);
    const buffer = await file.arrayBuffer();
    let binary = "";
    const chunk = 0x8000;
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i += chunk) {
      binary += String.fromCharCode(...view.subarray(i, i + chunk));
    }
    try {
      await ipc.client.settings.dropBrandLogo({
        filename: file.name,
        base64: btoa(binary),
      });
      await refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : String(err));
    }
  }

  const logoUri = preview.data ?? null;

  return (
    <Panel>
      <SpecRows>
        <SpecRow label={t("brand.name")} hint={t("brand.nameHint")}>
          <Input
            className="max-w-sm"
            value={saved?.brandName ?? ""}
            placeholder={t("brand.namePlaceholder")}
            onChange={(e) => void patch({ brandName: e.target.value || null })}
          />
        </SpecRow>

        <SpecRow label={t("brand.accent")} hint={t("brand.accentHint")}>
          <div className="flex max-w-sm items-center gap-2">
            <span
              aria-hidden="true"
              className="size-9 flex-none rounded-md border border-border"
              style={{ background: parsedAccent ?? "transparent" }}
            />
            <Input
              className="min-w-0 flex-1 font-mono"
              value={draft}
              placeholder={t("brand.accentPlaceholder")}
              aria-invalid={accentInvalid}
              onChange={(e) => setAccentDraft(e.target.value)}
              onBlur={() => void patch({ brandAccent: parsedAccent })}
            />
          </div>
          {accentInvalid ? (
            <p role="alert" className="mt-1.5 text-xs text-error">
              {t("brand.accentInvalid")}
            </p>
          ) : null}
        </SpecRow>

        {/*
         * A real preview of the real file. The logo is copied into the app's
         * own storage on drop, so what is shown here is the copy the attendee
         * app will serve — not the original, which the engineer is free to
         * delete once it is in.
         */}
        <SpecRow label={t("brand.logo")} hint={t("brand.logoHint")}>
          <div
            ref={dropRef}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void acceptFile(file);
            }}
            className={cn(
              "flex max-w-sm items-center gap-3 rounded-lg border border-dashed p-3 transition-colors",
              dragging ? "border-live bg-live/10" : "border-border",
            )}
          >
            <div className="grid size-14 flex-none place-content-center overflow-hidden rounded-md bg-inset">
              {logoUri ? (
                <img src={logoUri} alt="" className="max-h-12 max-w-12 object-contain" />
              ) : (
                <ImagePlus className="size-5 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">
                {saved?.brandLogoPath ? basename(saved.brandLogoPath) : t("brand.logoNone")}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await ipc.client.settings.pickBrandLogo();
                    await refresh();
                  }}
                >
                  {t("brand.logoPick")}
                </Button>
                {saved?.brandLogoPath ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("brand.logoClear")}
                    onClick={() => void patch({ brandLogoPath: null })}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {logoError ? (
            <p role="alert" className="mt-1.5 max-w-sm text-xs text-error">
              {logoError}
            </p>
          ) : null}
        </SpecRow>

        <SpecRow label={t("brand.theme")} hint={t("brand.themeHint")}>
          <Select
            className="max-w-sm"
            value={saved?.brandTheme ?? ""}
            onChange={(e) =>
              void patch({ brandTheme: (e.target.value || null) as BrandTheme | null })
            }
          >
            <option value="">{t("brand.themeDefault")}</option>
            <option value="dark">{t("brand.themeDark")}</option>
            <option value="light">{t("brand.themeLight")}</option>
            <option value="auto">{t("brand.themeAuto")}</option>
          </Select>
        </SpecRow>
      </SpecRows>

      <Notice tone="warn">{t("brand.appliesOnRefresh")}</Notice>
    </Panel>
  );
}
