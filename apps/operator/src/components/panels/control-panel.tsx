import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Group, Notice, Panel } from "@/components/ui/panel";
import { StatusLine, type Tone } from "@/components/ui/status-dot";
import type { ServerHostState } from "@/server-host/server-supervisor";
import { captureController, useCapture } from "../../hooks/use-capture.ts";
import { ipc } from "../../ipc/manager.ts";
import { parsePort } from "../../settings/port.ts";

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
  const [portDraft, setPortDraft] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });
  const server = useQuery({
    queryKey: ["serverStatus"],
    queryFn: () => ipc.client.server.status(),
    // The supervisor is in the main process; polling keeps the preload surface
    // to the one oRPC bridge the template already exposes.
    refetchInterval: 1000,
  });

  const status = server.data;
  const savedPort = settings.data?.port;

  useEffect(() => {
    if (savedPort !== undefined && portDraft === null) setPortDraft(String(savedPort));
  }, [savedPort, portDraft]);

  const parsedPort = parsePort(portDraft ?? "");
  const portInvalid = portDraft !== null && parsedPort === null;
  // The saved port is the next spawn's; the running server's is in `status`.
  // While they differ, nothing on the QR or the ingest socket has moved yet.
  const portPending =
    savedPort !== undefined && status?.port !== undefined && status.port !== savedPort;

  async function savePort() {
    if (parsedPort === null || parsedPort === savedPort) return;
    await ipc.client.settings.set({ port: parsedPort });
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

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
    <Panel>
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
        <label className="grid max-w-md gap-1.5">
          <span className="text-sm font-medium">{t("control.port")}</span>
          <Input
            inputMode="numeric"
            className="max-w-32 font-mono"
            value={portDraft ?? ""}
            aria-invalid={portInvalid}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={() => void savePort()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void savePort();
            }}
          />
          <span className="text-xs leading-snug text-muted-foreground">
            {t("control.portHint")}
          </span>
        </label>
        {portInvalid ? (
          <p role="alert" className="text-xs text-error">
            {t("control.portInvalid")}
          </p>
        ) : null}
        {portPending ? (
          <Notice tone="warn">{t("control.portRestart", { port: savedPort })}</Notice>
        ) : null}
      </Group>

      <Group label={t("control.apiKey")}>
        {/* The key itself never crosses IPC. The mask is enough to answer
            "is one saved, and is it the one I meant" at a sound desk that
            people walk past. */}
        <StatusLine tone={hasKey ? "live" : "warn"}>
          {hasKey ? (
            <span className="inline-flex items-center gap-2">
              {t("control.apiKeySet")}
              <span className="font-mono text-sm text-muted-foreground">
                {settings.data?.geminiApiKeyMask}
              </span>
            </span>
          ) : (
            t("control.apiKeyMissing")
          )}
        </StatusLine>
        <div className="flex max-w-md gap-2">
          <Input
            type="password"
            autoComplete="off"
            className="min-w-0 flex-1"
            placeholder={hasKey ? t("control.apiKeyReplace") : undefined}
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
