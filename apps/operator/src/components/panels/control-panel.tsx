import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UsageReport } from "@simul/protocol";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Group, Notice, Panel } from "@/components/ui/panel";
import { StatusLine, type Tone } from "@/components/ui/status-dot";
import type { ServerHostState } from "@/server-host/server-supervisor";
import { estimateUsd, formatUsd, sumUsage } from "../../admin/usage-cost.ts";
import { appLog } from "../../hooks/use-app-log.ts";
import { captureController, useCapture } from "../../hooks/use-capture.ts";
import { ipc } from "../../ipc/manager.ts";
import { languageLabel } from "../../settings/languages.ts";
import { parsePort } from "../../settings/port.ts";

const SERVER_TONE: Record<ServerHostState, Tone> = {
  stopped: "idle",
  starting: "warn",
  listening: "live",
  external: "live",
  crashed: "error",
  giving_up: "error",
};

const tokens = new Intl.NumberFormat("en-US");

/**
 * The running bill, from the server's own count of what Gemini has reported
 * charging for. Google's API has no way to ask what a key has spent, so this
 * is the nearest thing to a meter the desk can have — a sum since the server
 * started, priced at the list rates in usage-cost.ts, and a link to the page
 * that shows the real figure.
 */
function UsageMeter({ usage }: { usage: UsageReport | undefined }) {
  const { t, i18n } = useTranslation();
  if (!usage) return null;

  const total = sumUsage(usage.languages);
  const since = new Date(usage.since).toLocaleTimeString(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Group
      label={t("control.usageTitle")}
      aside={
        <Button variant="ghost" size="sm" onClick={() => void ipc.client.app.openUsageDashboard()}>
          {t("control.usageDashboard")}
          <ExternalLink data-icon="inline-end" />
        </Button>
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {t("control.usageSince", { time: since })}
        </span>
        <span className="font-mono text-2xl font-medium tabular-nums">
          {formatUsd(estimateUsd(total))}
        </span>
      </div>

      {usage.languages.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">{t("control.usageEmpty")}</p>
      ) : (
        <table className="max-w-xl text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 text-left font-medium">{t("control.usageLanguage")}</th>
              <th className="py-1 pr-4 text-right font-medium">{t("control.usageTokensHeader")}</th>
              <th className="py-1 text-right font-medium">{t("control.usageCost")}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {usage.languages.map((row) => (
              <tr key={row.lang}>
                <td className="py-1 pr-4 font-sans">{languageLabel(row.lang)}</td>
                <td className="py-1 pr-4 text-right text-muted-foreground">
                  {t("control.usageTokens", {
                    input: tokens.format(row.inputAudioTokens),
                    output: tokens.format(row.outputAudioTokens),
                  })}
                </td>
                <td className="py-1 text-right">{formatUsd(estimateUsd(row))}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="py-1 pr-4 font-sans font-medium">{t("control.usageTotal")}</td>
              <td className="py-1 pr-4 text-right text-muted-foreground">
                {t("control.usageTokens", {
                  input: tokens.format(total.inputAudioTokens),
                  output: tokens.format(total.outputAudioTokens),
                })}
              </td>
              <td className="py-1 text-right font-medium">{formatUsd(estimateUsd(total))}</td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="max-w-3xl text-xs leading-snug text-muted-foreground">
        {t("control.usageHint")}
      </p>
    </Group>
  );
}

export function ControlPanel({ usage }: { usage?: UsageReport | undefined }) {
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
    if (!current?.deviceId) {
      appLog.error(t("error.noDevice"));
      toast.warning(t("error.noDevice"));
      return;
    }
    appLog.info(
      t("log.startPressed", {
        label: current.deviceLabel ?? current.deviceId,
        channel: current.channelIndex + 1,
        requested: current.requestedChannelCount,
      }),
    );
    const token = await ipc.client.settings.ingestToken();
    await captureController.start({
      deviceId: current.deviceId,
      requestedChannelCount: current.requestedChannelCount,
      channelIndex: current.channelIndex,
      inputGainDb: current.inputGainDb,
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

      {hasKey ? <UsageMeter usage={usage} /> : null}
    </Panel>
  );
}
