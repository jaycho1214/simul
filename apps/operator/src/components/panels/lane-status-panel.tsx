import { useTranslation } from "react-i18next";
import type { LaneState, LaneStatus } from "@tongyeok/protocol";
import { Panel } from "@/components/ui/panel";
import { StatusDot, type Tone } from "@/components/ui/status-dot";
import { cn } from "@/utils/tailwind";
import { toLaneRow } from "../../admin/lane-row.ts";

/**
 * A lane cycling live → reconnecting → live every ~10 minutes is a normal
 * connection rotation, not a fault. So "reconnecting" gets the same amber as
 * every other in-progress state in the app and keeps its text at full
 * foreground; only "error" — the state the server itself reaches once its own
 * backoff has given up — gets red, and it gets it on the whole row.
 */
const SESSION_TONE: Record<LaneState, Tone> = {
  starting: "warn",
  live: "live",
  reconnecting: "warn",
  error: "error",
};

const NUM = "py-2 text-right font-mono tabular-nums";

export function LaneStatusPanel({ lanes }: { lanes: LaneStatus[] }) {
  const { t } = useTranslation();
  // toLaneRow's own `degraded` flag treats any non-"live" state as degraded,
  // which is right for the transcript UI it was built for but wrong here (see
  // SESSION_TONE), so the raw state rides alongside the row rather than
  // through `degraded`.
  const rows = lanes.map((status) => ({ row: toLaneRow(status), state: status.state }));

  return (
    <Panel title={t("panel.lanes")}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("lanes.empty")}</p>
      ) : (
        <>
          <table className="w-full text-sm">
            {/* Numeric columns are pinned narrow so a figure sits under its
                heading instead of drifting across the panel; the language and
                session-state columns take the slack. */}
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1.5 font-medium">{t("lanes.language")}</th>
                <th className="w-24 pb-1.5 text-right font-medium">{t("lanes.listeners")}</th>
                <th className="w-32 pb-1.5 text-right font-medium">
                  {t("lanes.audioListeners")}
                </th>
                <th className="w-20 pb-1.5 pl-6 font-medium">{t("lanes.status")}</th>
                <th className="w-24 pb-1.5 text-right font-medium">{t("lanes.laneDrops")}</th>
                <th className="w-28 pb-1.5 text-right font-medium">
                  {t("lanes.listenerDrops")}
                </th>
                <th className="w-32 pb-1.5 pl-6 font-medium">{t("lanes.sessionState")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {rows.map(({ row, state }) => (
                <tr
                  key={row.lang}
                  className={cn(
                    state === "error" && "bg-error/8 shadow-[inset_3px_0_0_0_var(--error)]",
                  )}
                >
                  <td className={cn("py-2 font-medium", state === "error" && "pl-3")}>
                    {row.label}
                  </td>
                  <td className={cn(NUM, "text-base")}>{row.listeners}</td>
                  {/* Never rendered alone: listeners holds steady across a
                      mute (it is the max of audio and transcript
                      subscriptions), so this is the only column that moves
                      when someone mutes. */}
                  <td className={cn(NUM, "text-muted-foreground")}>{row.audioListeners}</td>
                  <td className="py-2 pl-6">{t(row.openKey)}</td>
                  <td className={cn(NUM, row.laneDrops === 0 && "text-muted-foreground")}>
                    {row.laneDrops}
                  </td>
                  <td className={cn(NUM, row.listenerDrops === 0 && "text-muted-foreground")}>
                    {row.listenerDrops}
                  </td>
                  <td className="py-2 pl-6">
                    <span
                      className={cn(
                        "inline-flex items-center gap-2",
                        state === "error" && "font-semibold text-error",
                        state === "starting" && "text-muted-foreground",
                      )}
                    >
                      <StatusDot tone={SESSION_TONE[state]} />
                      {t(row.sessionKey)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs leading-snug text-muted-foreground">{t("lanes.laneDropsHint")}</p>
        </>
      )}
    </Panel>
  );
}
