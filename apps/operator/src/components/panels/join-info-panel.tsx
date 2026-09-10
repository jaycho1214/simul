import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Field, Group, Notice, Panel } from "@/components/ui/panel";
import { StatusLine } from "@/components/ui/status-dot";
import { cn } from "@/utils/tailwind";
import { joinUrl } from "../../net/lan-ip.ts";
import { ipc } from "../../ipc/manager.ts";

export function JoinInfoPanel({ externalListenerSeen }: { externalListenerSeen: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });
  const addresses = useQuery({
    queryKey: ["lanAddresses"],
    queryFn: () => ipc.client.network.lanAddresses(),
    // Wifi comes and goes on a venue laptop; re-poll so the QR is never stale.
    refetchInterval: 10_000,
  });

  const port = settings.data?.port ?? 8080;
  const pinned = settings.data?.lanAddress;
  const selected =
    addresses.data?.find((a) => a.address === pinned)?.address ?? addresses.data?.[0]?.address;
  const url = selected ? joinUrl(selected, port) : undefined;

  const qr = useQuery({
    queryKey: ["qr", url],
    enabled: Boolean(url),
    queryFn: () => toDataURL(url!, { width: 512, margin: 1, errorCorrectionLevel: "M" }),
  });

  const reachability = useQuery({
    queryKey: ["reachability", port, externalListenerSeen],
    queryFn: () => ipc.client.network.reachability({ port, externalListenerSeen }),
  });

  return (
    <Panel
      title={t("panel.join")}
      aside={
        <Button variant="ghost" size="sm" onClick={() => void reachability.refetch()}>
          {t("join.recheck")}
        </Button>
      }
    >
      {/*
       * Findings from earlier tasks, carried into this panel: the operator app
       * never opens /listen itself, so a lane reporting a listener is the only
       * signal in this whole app that a phone actually reached the laptop —
       * everything else here (LAN address, QR, the two Windows checks below)
       * is the app describing its own configuration. This line is that
       * proof, given its own headline rather than buried as one line among
       * three in the checklist below.
       */}
      <StatusLine tone={externalListenerSeen ? "live" : "warn"}>
        {externalListenerSeen ? t("join.externalSeen") : t("join.externalNone")}
      </StatusLine>

      {url ? (
        <div className="flex flex-col items-center gap-2 py-1">
          {/* A QR needs its own light quiet zone; it never inherits the theme. */}
          <div className="rounded-lg bg-white p-2">
            {qr.data ? <img src={qr.data} alt={url} className="block size-48" /> : null}
          </div>
          <p className="font-mono text-lg font-semibold tracking-tight break-all select-all">
            {url}
          </p>
          <p className="text-xs text-muted-foreground">{t("join.scan")}</p>
        </div>
      ) : (
        <Notice tone="warn">{t("join.noAddress")}</Notice>
      )}

      {(addresses.data?.length ?? 0) > 1 ? (
        <Field label={t("join.interface")}>
          <Select
            value={selected ?? ""}
            onChange={async (e) => {
              await ipc.client.settings.set({ lanAddress: e.target.value });
              await queryClient.invalidateQueries({ queryKey: ["settings"] });
            }}
          >
            {addresses.data?.map((address) => (
              <option key={address.address} value={address.address}>
                {address.interfaceName} — {address.address}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Group label={t("reach.title")}>
        <ul className="grid gap-1.5 text-sm">
          {reachability.data?.map((check) => (
            <li key={check.id} className="flex items-start gap-2 leading-snug">
              {/*
               * The type has no field distinguishing an advisory reading (this
               * laptop's own idea of its network profile / firewall rules —
               * either can be wrong) from proof (a phone actually connected).
               * Carried here in the UI instead: every row is tagged by which
               * kind of claim it is, so a "참고" line is never mistaken for the
               * same kind of confirmation as "실측".
               */}
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-sm px-1.5 text-[10px] leading-4 font-semibold",
                  check.id === "external_hit"
                    ? "bg-live/15 text-live"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {check.id === "external_hit" ? t("reach.proof") : t("reach.advisory")}
              </span>
              <span
                className={
                  check.status === "pass"
                    ? "text-foreground"
                    : check.status === "warn"
                      ? "text-warn"
                      : "text-muted-foreground"
                }
              >
                {t(check.messageKey, check.params)}
              </span>
            </li>
          ))}
        </ul>
      </Group>
    </Panel>
  );
}
