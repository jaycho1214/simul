import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { captureController, useCapture } from "../../hooks/use-capture.ts";
import { ipc } from "../../ipc/manager.ts";

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

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-semibold">{t("panel.control")}</h2>

      <div className="flex gap-2">
        <button
          className="rounded bg-emerald-600 px-6 py-3 text-lg font-semibold text-white disabled:opacity-40"
          disabled={capture.running || !settings.data?.deviceId}
          onClick={() => void start()}
        >
          {t("control.start")}
        </button>
        <button
          className="rounded bg-neutral-700 px-6 py-3 text-lg font-semibold text-white disabled:opacity-40"
          disabled={!capture.running}
          onClick={() => void captureController.stop()}
        >
          {t("control.stop")}
        </button>
      </div>

      {capture.error ? (
        <p className="mt-3 rounded bg-red-100 p-2 text-red-900">
          {t(`error.${capture.error.code}`, capture.error as Record<string, string>)}
        </p>
      ) : null}
      {capture.running && capture.ingestState !== "open" ? (
        <p className="mt-3 rounded bg-amber-100 p-2 text-amber-900">
          {t("error.ingestDisconnected")}
        </p>
      ) : null}

      <h3 className="mt-4 text-sm font-semibold">{t("control.serverTitle")}</h3>
      <p className="text-sm">{statusText}</p>
      {status?.detail ? (
        <p className="font-mono text-xs text-neutral-600">{status.detail}</p>
      ) : null}
      <button
        className="mt-1 text-sm underline"
        onClick={async () => {
          await ipc.client.server.restart();
          await queryClient.invalidateQueries({ queryKey: ["serverStatus"] });
        }}
      >
        {t("control.restart")}
      </button>

      <h3 className="mt-4 text-sm font-semibold">{t("control.apiKey")}</h3>
      <p className={settings.data?.hasGeminiApiKey ? "text-sm text-emerald-700" : "text-sm text-amber-700"}>
        {settings.data?.hasGeminiApiKey ? t("control.apiKeySet") : t("control.apiKeyMissing")}
      </p>
      <div className="mt-1 flex gap-2">
        <input
          type="password"
          className="flex-1 rounded border p-2"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button
          className="rounded border px-3"
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
        </button>
      </div>
    </section>
  );
}
