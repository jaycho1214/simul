import { useQuery } from "@tanstack/react-query";
import type { LaneStatus } from "@tongyeok/protocol";
import { useTranslation } from "react-i18next";
import { StatusChip, type Tone } from "@/components/ui/status-dot";
import { useCapture } from "@/hooks/use-capture";
import { ipc } from "@/ipc/manager";
import type { ServerHostState } from "@/server-host/server-supervisor";

const SERVER_TONE: Record<ServerHostState, Tone> = {
  stopped: "idle",
  starting: "warn",
  listening: "live",
  external: "live",
  crashed: "error",
  giving_up: "error",
};

/**
 * The strip that never scrolls away. Four facts, in the order the engineer
 * would ask for them if something felt wrong: is audio going in, is the
 * server up, how many phones are on, is any lane broken. The last chip only
 * exists while there is something to fix — a red pill appearing in the
 * corner of the eye is the alarm; nothing else here changes weight.
 */
export function HeaderStrip({ lanes }: { lanes: LaneStatus[] }) {
  const { t } = useTranslation();
  const capture = useCapture();

  // Same key ControlPanel polls; react-query shares the observer so this adds
  // no traffic to the IPC bridge.
  const server = useQuery({
    queryKey: ["serverStatus"],
    queryFn: () => ipc.client.server.status(),
    refetchInterval: 1000,
  });

  const listeners = lanes.reduce((sum, lane) => sum + lane.listeners, 0);
  const errorLanes = lanes.filter((lane) => lane.state === "error").length;

  const captureTone: Tone = !capture.running
    ? "idle"
    : capture.ingestState === "open"
      ? "live"
      : "warn";

  const status = server.data;

  return (
    <header className="draglayer sticky top-0 z-10 flex min-h-12 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur-sm">
      <h1 className="text-sm font-semibold tracking-tight">{t("appName")}</h1>

      <div className="flex items-center gap-2">
        <StatusChip tone={captureTone}>
          {capture.running ? t("strip.capturing") : t("strip.captureStopped")}
        </StatusChip>

        {status ? (
          <StatusChip tone={SERVER_TONE[status.state]}>
            {t(`control.server_${status.state}`, {
              port: status.port ?? 0,
              restarts: status.restarts,
            })}
          </StatusChip>
        ) : null}

        <StatusChip tone={listeners > 0 ? "live" : "idle"}>
          {t("strip.listeners", { n: listeners })}
        </StatusChip>

        {errorLanes > 0 ? (
          <StatusChip tone="error">{t("strip.errorLanes", { n: errorLanes })}</StatusChip>
        ) : null}
      </div>
    </header>
  );
}
