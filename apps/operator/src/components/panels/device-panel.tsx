import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listInputDevices } from "../../capture/capture-controller.ts";
import { useCapture } from "../../hooks/use-capture.ts";
import { ipc } from "../../ipc/manager.ts";

export function DevicePanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { report } = useCapture();

  const devices = useQuery({ queryKey: ["devices"], queryFn: listInputDevices });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });

  // The spec's failure row says the engineer must be able to re-pick after an
  // interface is unplugged. CaptureController only watches devicechange while it
  // is running, so the picker keeps its own listener and re-enumerates whenever
  // the device set changes — including while capture is stopped.
  useEffect(() => {
    const onChange = () => void queryClient.invalidateQueries({ queryKey: ["devices"] });
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [queryClient]);

  async function patch(next: Parameters<typeof ipc.client.settings.set>[0]) {
    await ipc.client.settings.set(next);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  const current = settings.data;
  const channelMax = report?.achievedChannelCount ?? current?.requestedChannelCount ?? 2;

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-semibold">{t("panel.device")}</h2>

      <label className="block text-sm">{t("device.select")}</label>
      <select
        className="mt-1 w-full rounded border p-2"
        value={current?.deviceId ?? ""}
        onChange={(e) => {
          const device = devices.data?.find((d) => d.deviceId === e.target.value);
          void patch({ deviceId: e.target.value, deviceLabel: device?.label ?? null });
        }}
      >
        <option value="">{t("device.none")}</option>
        {devices.data?.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || device.deviceId}
          </option>
        ))}
      </select>
      {devices.data?.some((d) => d.label === "") ? (
        <p className="mt-1 text-sm text-amber-600">{t("device.permissionNeeded")}</p>
      ) : null}
      <button className="mt-2 text-sm underline" onClick={() => void devices.refetch()}>
        {t("device.refresh")}
      </button>

      {/* getUserMedia has no way to ask a device how many channels it has, so
          the engineer states it. The spec's chain is "getUserMedia
          (channelCount: device max)"; on macOS the XR18 is one 18-channel
          device, on Windows the WDM driver hands out 2-channel USB pairs.
          Without this control the app can never reach channels 3–18 on macOS. */}
      <label className="mt-4 block text-sm">{t("device.requestedChannels")}</label>
      <input
        type="number"
        min={1}
        max={32}
        className="mt-1 w-full rounded border p-2"
        value={current?.requestedChannelCount ?? 2}
        onChange={(e) => void patch({ requestedChannelCount: Number(e.target.value) })}
      />
      <p className="mt-1 text-xs text-neutral-500">{t("device.requestedChannelsHint")}</p>

      <label className="mt-4 block text-sm">{t("device.channel")}</label>
      <select
        className="mt-1 w-full rounded border p-2"
        value={current?.channelIndex ?? 0}
        onChange={(e) => void patch({ channelIndex: Number(e.target.value) })}
      >
        {Array.from({ length: channelMax }, (_, i) => (
          <option key={i} value={i}>
            {i + 1}
          </option>
        ))}
      </select>

      <dl className="mt-4 space-y-1 text-sm">
        <div>
          {t("device.channelCount", {
            requested: report?.requestedChannelCount ?? current?.requestedChannelCount ?? 0,
            achieved: report?.achievedChannelCount ?? 0,
          })}
        </div>
        {/* Both numbers matter and mean different things: the device rate is
            what the interface is running at, the processing rate is what the
            AudioContext actually opened at and therefore what the server
            receives. They are almost never equal — 48000 in, 16000 out. */}
        <div>
          {t("device.sampleRate", {
            device: report?.deviceSampleRate ?? 0,
            processed: report?.contextSampleRate ?? 0,
          })}
        </div>
        <div className={report?.dspConfirmedOff ? "text-emerald-600" : "text-amber-600"}>
          {report?.dspConfirmedOff ? t("device.dspOff") : null}
        </div>
      </dl>

      {/* Every warning code maps to a Korean sentence in the string table; the
          component never composes copy itself. */}
      <ul className="mt-3 space-y-2">
        {report?.warnings.map((warning) => (
          <li key={warning.code} className="rounded bg-amber-100 p-2 text-sm text-amber-900">
            {t(`warn.${warning.code}`, {
              ...warning,
              flags: "flags" in warning ? warning.flags.join(", ") : undefined,
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
