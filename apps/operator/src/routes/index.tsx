import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HeaderStrip } from "../components/header-strip.tsx";
import { ControlPanel } from "../components/panels/control-panel.tsx";
import { DevicePanel } from "../components/panels/device-panel.tsx";
import { JoinInfoPanel } from "../components/panels/join-info-panel.tsx";
import { LaneStatusPanel } from "../components/panels/lane-status-panel.tsx";
import { LevelMeterPanel } from "../components/panels/level-meter-panel.tsx";
import { ServerLogPanel } from "../components/panels/server-log-panel.tsx";
import { useAdmin } from "../hooks/use-admin.ts";
import { ipc } from "../ipc/manager.ts";

export const Route = createFileRoute("/")({ component: OperatorWindow });

/**
 * Two stacked columns, like a rack. The left one is the signal path in the
 * order it is watched during the event — meter, lanes, then the device it
 * all comes from, then the log; the right one is what the engineer touches —
 * the transport and server, then the join card for whoever walks up asking.
 * Columns stack rather than grid-align so no panel is stretched to match a
 * taller neighbour.
 */
function OperatorWindow() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });
  const admin = useAdmin(settings.data?.port ?? 8080);

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <HeaderStrip lanes={admin.lanes} />
      <div className="grid grid-cols-[3fr_2fr] items-start gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-3">
          <LevelMeterPanel />
          <LaneStatusPanel lanes={admin.lanes} />
          <DevicePanel />
          <ServerLogPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <ControlPanel />
          <JoinInfoPanel externalListenerSeen={admin.externalListenerSeen} />
        </div>
      </div>
    </main>
  );
}
