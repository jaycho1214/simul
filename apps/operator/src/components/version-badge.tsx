import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getAppVersion } from "@/actions/app";

/**
 * Which build this is, always on screen — the first thing anyone asks when a
 * venue laptop misbehaves. Task 11 adds the update affordances beside it.
 */
export function VersionBadge() {
  const { t } = useTranslation();
  const version = useQuery({
    queryKey: ["appVersion"],
    queryFn: getAppVersion,
    staleTime: Infinity,
  });

  return (
    <span
      className="font-mono text-xs tabular-nums text-muted-foreground"
      title={version.data ? t("footer.version", { version: version.data }) : undefined}
    >
      {version.data ? `v${version.data}` : ""}
    </span>
  );
}
