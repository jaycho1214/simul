import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Group, Notice, Panel } from "@/components/ui/panel";
import { StatusLine, type Tone } from "@/components/ui/status-dot";
import type { ServerHostState } from "@/server-host/server-supervisor";
import { captureController, useCapture } from "../../hooks/use-capture.ts";
import { ipc } from "../../ipc/manager.ts";

const SERVER_TONE: Record<ServerHostState, Tone> = {
  stopped: "idle",
  starting: "warn",
  listening: "live",
  external: "live",
  crashed: "error",
  giving_up: "error",
};

export function ControlPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const capture = useCapture();
  const [apiKey, setApiKey] = useState("");

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });
  const server = useQuery({
    queryKey: ["serverStatus"],
    queryFn: () => ipc.client.server.status(),
    // The supervisor is in the main process; polling keeps the preload surface
    // to the one oRPC bridge the template already exposes.
    refetchInterval: 1000,
  });

  const status = server.data;
  // ServerHostState has one string-table entry per member: control.server_stopped
  // / _starting / _listening / _crashed / _giving_up / _external.
  const statusText = status
    ? t(`control.server_${status.state}`, {
        port: status.port ?? 0,
        restarts: status.restarts,
      })
    : "";

  async function start() {
    const current = settings.data;
    if (!current?.deviceId) return;
    const token = await ipc.client.settings.ingestToken();
    await captureController.start({
      deviceId: current.deviceId,
      requestedChannelCount: current.requestedChannelCount,
      channelIndex: current.channelIndex,
      port: current.port,
      ingestToken: token,
    });
    // Labels are blank until the first permission grant, so refresh the list.
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
  }

  const hasKey = settings.data?.hasGeminiApiKey ?? false;

  return (
    <Panel title={t("panel.control")}>
      {/* The transport. Start is the one filled green control in the app;
          stop is outlined so it is findable without shouting, and neither is
          ever ambiguous about which one is available right now. */}
      <div className="flex gap-2">
        <Button
          className="h-11 flex-1 bg-live text-base font-semibold text-[oklch(0.2_0.03_155)] hover:bg-live/90"
          disabled={capture.running || !settings.data?.deviceId}
          onClick={() => void start()}
        >
          {t("control.start")}
        </Button>
        <Button
          variant="outline"
          className="h-11 flex-1 text-base font-semibold"
          disabled={!capture.running}
          onClick={() => void captureController.stop()}
        >
          {t("control.stop")}
        </Button>
      </div>

      {capture.error ? (
        <Notice tone="error">
          {t(`error.${capture.error.code}`, capture.error as Record<string, string>)}
        </Notice>
      ) : null}
      {capture.running && capture.ingestState !== "open" ? (
        <Notice tone="warn">{t("error.ingestDisconnected")}</Notice>
      ) : null}

      <Group
        label={t("control.serverTitle")}
        aside={
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await ipc.client.server.restart();
              await queryClient.invalidateQueries({ queryKey: ["serverStatus"] });
            }}
          >
            {t("control.restart")}
          </Button>
        }
      >
        {status ? <StatusLine tone={SERVER_TONE[status.state]}>{statusText}</StatusLine> : null}
        {status?.detail ? (
          <p className="font-mono text-xs break-all text-muted-foreground">{status.detail}</p>
        ) : null}
      </Group>

      <Group label={t("control.apiKey")}>
        <StatusLine tone={hasKey ? "live" : "warn"}>
          {hasKey ? t("control.apiKeySet") : t("control.apiKeyMissing")}
        </StatusLine>
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button
            variant="secondary"
            className="h-9 px-4 text-sm"
            onClick={async () => {
              await ipc.client.settings.set({ geminiApiKey: apiKey });
              setApiKey("");
              await queryClient.invalidateQueries({ queryKey: ["settings"] });
              // The supervisor re-reads settings on every spawn, but the running
              // process still holds the old key, so the restart is explicit. It
              // is safe here because saving a key is a pre-event action.
              await ipc.client.server.restart();
            }}
          >
            {t("control.save")}
          </Button>
        </div>
      </Group>
    </Panel>
  );
}
