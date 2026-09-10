import { useTranslation } from "react-i18next";
import type { LaneStatus } from "@tongyeok/protocol";
import { toLaneRow } from "../../admin/lane-row.ts";

export function LaneStatusPanel({ lanes }: { lanes: LaneStatus[] }) {
  const { t } = useTranslation();
  // toLaneRow's own `degraded` flag treats any non-"live" state as degraded,
  // which is right for the transcript UI it was built for but wrong here: a
  // lane cycling live → reconnecting → live every ~10 minutes is a normal
  // connection rotation, not a fault, and highlighting it would teach the
  // engineer to stop trusting the highlight. So the raw state rides alongside
  // the row rather than through `degraded`, and only "error" gets an alarm
  // treatment below — that is the one state the server itself only reaches
  // once its own backoff has given up.
  const rows = lanes.map((status) => ({ row: toLaneRow(status), state: status.state }));

  return (
    <section className="col-span-2 rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-semibold">{t("panel.lanes")}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">{t("lanes.empty")}</p>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1">{t("lanes.language")}</th>
                <th className="py-1">{t("lanes.listeners")}</th>
                <th className="py-1">{t("lanes.audioListeners")}</th>
                <th className="py-1">{t("lanes.status")}</th>
                <th className="py-1">{t("lanes.laneDrops")}</th>
                <th className="py-1">{t("lanes.listenerDrops")}</th>
                <th className="py-1">{t("lanes.sessionState")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, state }) => (
                <tr key={row.lang} className={state === "error" ? "bg-red-50" : undefined}>
                  <td className="py-1 font-medium">{row.label}</td>
                  <td className="py-1 tabular-nums">{row.listeners}</td>
                  {/* Never rendered alone: listeners holds steady across a
                      mute (it is the max of audio and transcript
                      subscriptions), so this is the only column that moves
                      when someone mutes. */}
                  <td className="py-1 tabular-nums">{row.audioListeners}</td>
                  <td className="py-1">{t(row.openKey)}</td>
                  <td className="py-1 tabular-nums">{row.laneDrops}</td>
                  <td className="py-1 tabular-nums">{row.listenerDrops}</td>
                  <td
                    className={
                      state === "error"
                        ? "py-1 font-semibold text-red-700"
                        : state === "live"
                          ? "py-1"
                          : "py-1 text-neutral-500"
                    }
                  >
                    {t(row.sessionKey)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-500">{t("lanes.laneDropsHint")}</p>
        </>
      )}
    </section>
  );
}
