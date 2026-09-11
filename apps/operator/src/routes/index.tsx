import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { OperatorRail, type SectionId } from "../components/operator-rail.tsx";
import { OperatorToolbar } from "../components/operator-toolbar.tsx";
import { BrandPanel } from "../components/panels/brand-panel.tsx";
import { ControlPanel } from "../components/panels/control-panel.tsx";
import { DevicePanel } from "../components/panels/device-panel.tsx";
import { JoinInfoPanel } from "../components/panels/join-info-panel.tsx";
import { LanguagePanel } from "../components/panels/language-panel.tsx";
import { LaneStatusPanel } from "../components/panels/lane-status-panel.tsx";
import { LevelMeterPanel } from "../components/panels/level-meter-panel.tsx";
import { ServerLogPanel } from "../components/panels/server-log-panel.tsx";
import { useAdmin } from "../hooks/use-admin.ts";
import { ipc } from "../ipc/manager.ts";

export const Route = createFileRoute("/")({ component: OperatorWindow });

/**
 * A rail and one section at a time.
 *
 * The app is really two apps sharing a window: a handful of things set once
 * before doors, and a small instrument cluster watched for ninety minutes
 * after. Six equal-weight panels in two columns served neither. The rail
 * separates them and carries the transport, so start and stop are reachable
 * from anywhere; the toolbar carries the input level, the listener count and
 * any failing lane, so navigating into a setup section never takes the live
 * numbers off screen — which is the only thing that makes a sidebar safe to
 * use during a service.
 */
function OperatorWindow() {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("live");

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => ipc.client.settings.get(),
  });
  const admin = useAdmin(settings.data?.port ?? 8080);

  return (
    <main className="flex h-full">
      <OperatorRail active={section} onSelect={setSection} lanes={admin.lanes} />

      <div className="flex min-w-0 flex-1 flex-col">
        <OperatorToolbar
          title={t(`section.${section}`)}
          lanes={admin.lanes}
          action={
            section === "server" ? (
              <Button variant="outline" size="sm" onClick={() => void ipc.client.server.restart()}>
                {t("control.restart")}
              </Button>
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {section === "live" ? (
            <div className="grid content-start gap-8">
              <LevelMeterPanel />
              <LaneStatusPanel lanes={admin.lanes} />
              <LanguagePanel />
            </div>
          ) : section === "device" ? (
            <DevicePanel />
          ) : section === "join" ? (
            <JoinInfoPanel externalListenerSeen={admin.externalListenerSeen} />
          ) : section === "brand" ? (
            <BrandPanel />
          ) : (
            <div className="grid content-start gap-8">
              <ControlPanel />
              <ServerLogPanel />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
