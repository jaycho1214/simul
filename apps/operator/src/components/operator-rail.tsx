import { useQuery } from "@tanstack/react-query";
import type { LaneStatus } from "@simul/protocol";
import { Image, Mic, QrCode, Radio, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusDot, type Tone } from "@/components/ui/status-dot";
import { cn } from "@/utils/tailwind";
import { captureController, useCapture } from "../hooks/use-capture.ts";
import { ipc } from "../ipc/manager.ts";
import { LanguageToggle } from "./language-toggle.tsx";
import { RestartToUpdateLink, VersionBadge } from "./version-badge.tsx";

export type SectionId = "live" | "device" | "join" | "brand" | "server";

const SECTIONS: Array<{ id: SectionId; icon: typeof Radio }> = [
  { id: "live", icon: Radio },
  { id: "device", icon: Mic },
  { id: "join", icon: QrCode },
  { id: "brand", icon: Image },
  { id: "server", icon: Server },
];

export interface OperatorRailProps {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  lanes: LaneStatus[];
}

/**
 * Navigation, and the transport.
 *
 * The rail is full height, so its top 36px belong to the macOS traffic lights
 * (titleBarStyle "hiddenInset", trafficLightPosition 5,5) and are left empty
 * and draggable. Start and stop live at the bottom rather than inside a
 * section, because a sidebar that can navigate away from the transport during
 * an event is a sidebar that hides the one control an engineer might need in a
 * hurry.
 *
 * Each row carries its current value on a second line, so the whole
 * configuration can be read off the rail without opening anything — which is
 * most of what "is this set up right?" means an hour before doors. A status
 * dot appears only for a section in warn or error: a rail of grey dots trains
 * the eye to stop reading them.
 */
export function OperatorRail({ active, onSelect, lanes }: OperatorRailProps) {
  const { t } = useTranslation();
  const capture = useCapture();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => ipc.client.settings.get(),
  });
  const addresses = useQuery({
    queryKey: ["lanAddresses"],
    queryFn: () => ipc.client.network.lanAddresses(),
    refetchInterval: 10_000,
  });
  const server = useQuery({
    queryKey: ["serverStatus"],
    queryFn: () => ipc.client.server.status(),
    refetchInterval: 1000,
  });

  const current = settings.data;
  const errorLanes = lanes.filter((l) => l.state === "error").length;
  const warnLanes = lanes.filter((l) => l.state === "reconnecting").length;
  const address = current?.lanAddress ?? addresses.data?.[0]?.address;
  const status = server.data;

  const alerts: Partial<Record<SectionId, Tone>> = {
    live: errorLanes > 0 ? "error" : warnLanes > 0 ? "warn" : undefined,
    device: capture.error ? "error" : undefined,
    server: status?.state === "crashed" || status?.state === "giving_up" ? "error" : undefined,
  };

  const subtitles: Record<SectionId, string> = {
    live: t("rail.sub_live", { n: lanes.length }),
    device: current?.deviceLabel ?? t("rail.sub_noDevice"),
    join: address ? `${address}:${current?.port ?? 8080}` : t("rail.sub_noAddress"),
    brand: current?.brandName ?? t("rail.sub_unbranded"),
    server: status?.port ? t("rail.sub_server", { port: status.port }) : t("rail.sub_serverDown"),
  };

  return (
    <nav className="flex w-[236px] flex-none flex-col overflow-hidden border-r border-border bg-card/40">
      {/* The traffic lights land here. Draggable, and deliberately empty. */}
      <div className="draglayer h-9 flex-none" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-3 pb-3">
        <div className="px-1.5 pb-1">
          <div className="text-sm font-semibold tracking-tight">{t("appName")}</div>
        </div>

        {/*
          `minmax(0, 1fr)` rather than a bare `grid`: a grid item's default
          `min-width: auto` sizes the track to its content's min-content width,
          and each row's subtitle is `truncate` — which means `nowrap`, which
          means one unbreakable box. A device called "Default - MacBook Pro
          Microphone (Built-in)" then pushed the whole track past the rail's
          fixed 236px and the rows spilled over the content area, with the
          ellipsis never firing because the box was already as wide as the
          text.
        */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                active === section.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              <section.icon className="size-4 flex-none" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t(`section.${section.id}`)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {subtitles[section.id]}
                </span>
              </span>
              {alerts[section.id] ? <StatusDot tone={alerts[section.id]!} /> : null}
            </button>
          ))}
        </div>

        <div className="mt-auto grid gap-2 border-t border-border pt-3">
          <Button
            className="h-10 w-full bg-live text-sm font-semibold text-[oklch(0.2_0.03_155)] hover:bg-live/90"
            disabled={capture.running || !current?.deviceId}
            onClick={() => void startCapture()}
          >
            {t("control.start")}
          </Button>
          <Button
            variant="outline"
            className="h-10 w-full text-sm font-semibold"
            disabled={!capture.running}
            onClick={() => void captureController.stop()}
          >
            {t("control.stop")}
          </Button>
          <div className="grid min-w-0 gap-1 pt-1">
            <RestartToUpdateLink />
            <div className="flex min-w-0 items-center justify-between gap-2">
              <LanguageToggle />
              <VersionBadge />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );

  async function startCapture() {
    if (!current?.deviceId) return;
    const token = await ipc.client.settings.ingestToken();
    await captureController.start({
      deviceId: current.deviceId,
      requestedChannelCount: current.requestedChannelCount,
      channelIndex: current.channelIndex,
      port: current.port,
      ingestToken: token,
    });
  }
}
