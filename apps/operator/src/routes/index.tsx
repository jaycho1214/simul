import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ControlPanel } from "../components/panels/control-panel.tsx";
import { DevicePanel } from "../components/panels/device-panel.tsx";
import { JoinInfoPanel } from "../components/panels/join-info-panel.tsx";
import { LaneStatusPanel } from "../components/panels/lane-status-panel.tsx";
import { LevelMeterPanel } from "../components/panels/level-meter-panel.tsx";
import { ServerLogPanel } from "../components/panels/server-log-panel.tsx";
import { useAdmin } from "../hooks/use-admin.ts";
import { ipc } from "../ipc/manager.ts";

export const Route = createFileRoute("/")({ component: OperatorWindow });

function OperatorWindow() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });
  const admin = useAdmin(settings.data?.port ?? 8080);

  return (
    <main className="grid h-full grid-cols-2 gap-4 overflow-auto p-4">
      <h1 className="col-span-2 text-2xl font-semibold">{t("appName")}</h1>
      <DevicePanel />
      <LevelMeterPanel />
      <JoinInfoPanel externalListenerSeen={admin.externalListenerSeen} />
      <ControlPanel />
      <LaneStatusPanel lanes={admin.lanes} />
      <ServerLogPanel />
    </main>
  );
}
