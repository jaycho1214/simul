import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Notice, Panel } from "@/components/ui/panel";
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
    <Panel
      title={t("panel.device")}
      aside={
        <Button variant="ghost" size="sm" onClick={() => void devices.refetch()}>
          <RefreshCw data-icon="inline-start" />
          {t("device.refresh")}
        </Button>
      }
    >
      <Field label={t("device.select")}>
        <Select
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
        </Select>
      </Field>
      {devices.data?.some((d) => d.label === "") ? (
        <Notice tone="warn">{t("device.permissionNeeded")}</Notice>
      ) : null}

      {/* getUserMedia has no way to ask a device how many channels it has, so
          the engineer states it. The spec's chain is "getUserMedia
          (channelCount: device max)"; on macOS the XR18 is one 18-channel
          device, on Windows the WDM driver hands out 2-channel USB pairs.
          Without this control the app can never reach channels 3–18 on macOS. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("device.requestedChannels")}>
          <Input
            type="number"
            min={1}
            max={32}
            className="font-mono tabular-nums"
            value={current?.requestedChannelCount ?? 2}
            onChange={(e) => void patch({ requestedChannelCount: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("device.channel")}>
          <Select
            className="font-mono tabular-nums"
            value={current?.channelIndex ?? 0}
            onChange={(e) => void patch({ channelIndex: Number(e.target.value) })}
          >
            {Array.from({ length: channelMax }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="-mt-1 text-xs leading-snug text-muted-foreground">
        {t("device.requestedChannelsHint")}
      </p>

      {/* What the chain actually opened at, as opposed to what was asked for.
          A recessed readout so it reads as measured, not editable. */}
      <div className="grid gap-1 rounded-md bg-inset px-3 py-2 text-xs text-muted-foreground tabular-nums">
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
        {report?.dspConfirmedOff ? <div className="text-live">{t("device.dspOff")}</div> : null}
      </div>

      {/* Every warning code maps to a Korean sentence in the string table; the
          component never composes copy itself. */}
      {report?.warnings.length ? (
        <ul className="grid gap-2">
          {report.warnings.map((warning) => (
            <li key={warning.code}>
              <Notice tone="warn">
                {t(`warn.${warning.code}`, {
                  ...warning,
                  flags: "flags" in warning ? warning.flags.join(", ") : undefined,
                })}
              </Notice>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
