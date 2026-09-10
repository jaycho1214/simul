export interface NetworkInterfaceEntry {
  address: string;
  family: string;
  internal: boolean;
  mac: string;
  netmask: string;
}

/** The shape of os.networkInterfaces(), passed in so this stays pure. */
export type NetworkInterfaceMap = Record<string, NetworkInterfaceEntry[] | undefined>;

export interface LanAddress {
  address: string;
  interfaceName: string;
  kind: "private" | "link-local" | "other";
  virtual: boolean;
}

/**
 * Adapters that exist but never carry venue traffic: hypervisor switches,
 * container bridges, VPN tunnels and Apple's peer-to-peer radios. Ranked below
 * real adapters rather than hidden, because occasionally one of them is the one
 * that works.
 */
const VIRTUAL_NAME =
  /^(vethernet|virtualbox|vmware|hyper-v|docker|br-|veth|utun|awdl|llw|bridge\d|tailscale|zerotier|zt|ppp|tap|tun)/i;

function classify(address: string): LanAddress["kind"] {
  const octets = address.split(".").map(Number);
  const [a, b] = octets;
  if (a === undefined || b === undefined) return "other";
  if (a === 169 && b === 254) return "link-local";
  if (a === 10) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  return "other";
}

const KIND_RANK: Record<LanAddress["kind"], number> = {
  private: 0,
  other: 1,
  "link-local": 2,
};

/**
 * Every usable IPv4 address, best first. "Best" means a real adapter on a
 * private range, because that is what venue wifi hands out and what a phone on
 * the same network can reach. Order chosen: private > other (CGNAT/public-ish,
 * e.g. Tailscale's 100.64/10 or a routable-but-unusual address) > link-local,
 * because an APIPA address only appears when DHCP failed on that adapter and is
 * almost never reachable from a phone. Within a kind, a real adapter ranks
 * above a recognised virtual one, and ties are broken by input order so the
 * result is deterministic across runs on the same machine.
 */
export function pickLanAddresses(interfaces: NetworkInterfaceMap): LanAddress[] {
  const found: LanAddress[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push({
        address: entry.address,
        interfaceName,
        kind: classify(entry.address),
        virtual: VIRTUAL_NAME.test(interfaceName),
      });
    }
  }

  return found
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const kind = KIND_RANK[a.value.kind] - KIND_RANK[b.value.kind];
      if (kind !== 0) return kind;
      const virtual = Number(a.value.virtual) - Number(b.value.virtual);
      if (virtual !== 0) return virtual;
      return a.index - b.index; // stable
    })
    .map(({ value }) => value);
}

/** Spec: the QR encodes http://<lan-ip>:8080. */
export function joinUrl(address: string, port: number): string {
  return `http://${address}:${port}`;
}
