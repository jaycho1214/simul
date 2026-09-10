import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import { useTranslation } from "react-i18next";
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
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-semibold">{t("panel.join")}</h2>

      {/*
       * Findings from earlier tasks, carried into this panel: the operator app
       * never opens /listen itself, so a lane reporting a listener is the only
       * signal in this whole app that a phone actually reached the laptop —
       * everything else here (LAN address, QR, the two Windows checks below)
       * is the app describing its own configuration. This banner is that
       * proof, given its own headline rather than buried as one line among
       * three in the checklist below.
       */}
      <p
        className={
          externalListenerSeen
            ? "text-sm font-medium text-emerald-700"
            : "text-sm font-medium text-amber-700"
        }
      >
        {externalListenerSeen ? t("join.externalSeen") : t("join.externalNone")}
      </p>

      {url ? (
        <>
          {qr.data ? (
            <img src={qr.data} alt={url} className="mx-auto h-64 w-64" />
          ) : null}
          <p className="mt-3 text-center font-mono text-3xl font-bold tracking-tight">{url}</p>
          <p className="mt-1 text-center text-sm">{t("join.scan")}</p>
        </>
      ) : (
        <p className="text-amber-700">{t("join.noAddress")}</p>
      )}

      {(addresses.data?.length ?? 0) > 1 ? (
        <>
          <label className="mt-4 block text-sm">{t("join.interface")}</label>
          <select
            className="mt-1 w-full rounded border p-2"
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
          </select>
        </>
      ) : null}

      <h3 className="mt-4 text-sm font-semibold">{t("reach.title")}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {reachability.data?.map((check) => (
          <li
            key={check.id}
            className={
              check.status === "pass"
                ? "text-emerald-700"
                : check.status === "warn"
                  ? "text-amber-700"
                  : "text-neutral-500"
            }
          >
            {/*
             * The type has no field distinguishing an advisory reading (this
             * laptop's own idea of its network profile / firewall rules —
             * either can be wrong) from proof (a phone actually connected).
             * Carried here in the UI instead: every row is tagged by which
             * kind of claim it is, so a "참고" line is never mistaken for the
             * same kind of confirmation as "실측".
             */}
            <span
              className={
                check.id === "external_hit"
                  ? "mr-1 rounded bg-emerald-600 px-1 text-[10px] font-semibold text-white"
                  : "mr-1 rounded bg-neutral-200 px-1 text-[10px] font-semibold text-neutral-600"
              }
            >
              {check.id === "external_hit" ? t("reach.proof") : t("reach.advisory")}
            </span>
            {t(check.messageKey, check.params)}
          </li>
        ))}
      </ul>
      <button className="mt-2 text-sm underline" onClick={() => void reachability.refetch()}>
        {t("join.recheck")}
      </button>
    </section>
  );
}
