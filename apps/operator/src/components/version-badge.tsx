import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAppVersion } from "@/actions/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/tailwind";
import { useUpdateState } from "../hooks/use-update-state.ts";
import { ipc } from "../ipc/manager.ts";

/**
 * Which build this is, always on screen — the first thing anyone asks when a
 * venue laptop misbehaves — plus a manual check for "please update before
 * the event". The check icon disappears where the updater is off
 * (development, macOS) and once a version is staged, when
 * RestartToUpdateLink takes over.
 */
export function VersionBadge() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const version = useQuery({
    queryKey: ["appVersion"],
    queryFn: getAppVersion,
    staleTime: Infinity,
  });
  const update = useUpdateState();

  const busy = update?.status === "checking" || update?.status === "downloading";
  const busyLabel =
    update?.status === "downloading" ? t("update.downloading") : t("update.checking");

  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
      <span title={version.data ? t("footer.version", { version: version.data }) : undefined}>
        {version.data ? `v${version.data}` : ""}
      </span>
      {update && update.status !== "disabled" && update.status !== "ready" ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={busy ? busyLabel : t("update.check")}
          title={busy ? busyLabel : t("update.check")}
          disabled={busy}
          onClick={() => {
            void ipc.client.updates
              .check()
              .then(() => queryClient.invalidateQueries({ queryKey: ["updateState"] }));
          }}
        >
          <RefreshCw className={cn(busy && "animate-spin")} />
        </Button>
      ) : null}
    </span>
  );
}

/**
 * The quiet restart affordance that survives a dismissed toast. On its own
 * line: next to the language toggle and the version it does not fit the
 * 236px rail in either language, and a footer that overflows pushes the
 * transport buttons out of the window.
 */
export function RestartToUpdateLink() {
  const { t } = useTranslation();
  const update = useUpdateState();
  if (update?.status !== "ready") return null;

  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto justify-start px-0 text-xs text-live"
      onClick={() => void ipc.client.updates.install()}
    >
      {t("update.restartLink")}
    </Button>
  );
}
