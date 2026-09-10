export interface ProbeConnection {
  interfaceAlias: string;
  networkCategory: string;
}

export interface ProbeFirewallProfile {
  name: string;
  enabled: string;
  defaultInboundAction: string;
}

export interface ProbeRule {
  displayName: string;
  profile: string;
}

export interface ReachabilityProbe {
  connections: ProbeConnection[];
  firewallProfiles: ProbeFirewallProfile[];
  rules: ProbeRule[];
}

export type ReachabilityStatus = "pass" | "warn" | "unknown";

/**
 * "advisory" checks read configuration that *looks* right but is not evidence
 * anything actually got through — the laptop probing itself never crosses the
 * inbound firewall path. "proof" is the one check that can only be true because
 * a foreign device completed a real request. This travels with the data
 * precisely so a UI author doesn't have to remember which of three `id`
 * strings is the real one.
 */
export type ReachabilityKind = "advisory" | "proof";

export interface ReachabilityCheck {
  id: "network_profile" | "firewall_rule" | "external_hit";
  status: ReachabilityStatus;
  kind: ReachabilityKind;
  /** Key into the Korean string table; the UI never builds copy itself. */
  messageKey: string;
  params: Record<string, string | number>;
}

/**
 * Read-only. Every cmdlet here is a Get-, and the probe must never be allowed to
 * change firewall state — creating a rule silently is exactly the kind of
 * invisible action that makes a venue laptop untrustworthy the next time.
 * Get-NetConnectionProfile and Get-NetFirewallRule both read without elevation.
 */
export function REACHABILITY_POWERSHELL(port: number): string {
  return `
$ErrorActionPreference = 'Stop'
$port = ${port}
$conn = @(Get-NetConnectionProfile |
  Select-Object InterfaceAlias, @{n='NetworkCategory';e={$_.NetworkCategory.ToString()}})
$fwp = @(Get-NetFirewallProfile |
  Select-Object Name,
    @{n='Enabled';e={$_.Enabled.ToString()}},
    @{n='DefaultInboundAction';e={$_.DefaultInboundAction.ToString()}})
$rules = @(Get-NetFirewallPortFilter |
  Where-Object { $_.Protocol -eq 'TCP' -and ($_.LocalPort -contains "$port" -or $_.LocalPort -eq 'Any') } |
  Get-NetFirewallRule |
  Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } |
  Select-Object DisplayName, @{n='Profile';e={$_.Profile.ToString()}})
[pscustomobject]@{ connections = $conn; firewallProfiles = $fwp; rules = $rules } |
  ConvertTo-Json -Depth 4 -Compress
`.trim();
}

/** PowerShell 5.1's ConvertTo-Json unrolls one-element arrays into objects. */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

export function parseReachabilityProbe(json: string): ReachabilityProbe {
  const raw = JSON.parse(json) as Record<string, unknown>;

  return {
    connections: asArray<Record<string, unknown>>(raw.connections).map((c) => ({
      interfaceAlias: String(c.InterfaceAlias ?? ""),
      networkCategory: String(c.NetworkCategory ?? ""),
    })),
    firewallProfiles: asArray<Record<string, unknown>>(raw.firewallProfiles).map((p) => ({
      name: String(p.Name ?? ""),
      enabled: String(p.Enabled ?? ""),
      defaultInboundAction: String(p.DefaultInboundAction ?? ""),
    })),
    rules: asArray<Record<string, unknown>>(raw.rules).map((r) => ({
      displayName: String(r.DisplayName ?? ""),
      profile: String(r.Profile ?? ""),
    })),
  };
}

/** Windows maps NetworkCategory onto firewall profile names by these aliases. */
function categoryToProfileName(category: string): string {
  return category.toLowerCase() === "domainauthenticated" ? "domain" : category.toLowerCase();
}

function profileMatches(rule: string, category: string): boolean {
  const normalised = rule.toLowerCase();
  if (normalised === "any" || normalised === "") return true;
  return normalised.split(/\s*,\s*/).includes(categoryToProfileName(category));
}

export interface EvaluateReachabilityInput {
  platform: NodeJS.Platform | string;
  port: number;
  probe: ReachabilityProbe | undefined;
  /** True once any lane on the /admin feed has reported a listener. */
  externalListenerSeen: boolean;
}

/**
 * The rule check has no active-profile fallback to assume. Unlike
 * network_profile it cannot report anything about "the" active profile when
 * there isn't a known one — defaulting to Private (the permissive profile)
 * would produce a "pass" on exactly the axis this task exists to catch, so an
 * empty `connections` list means unknown here too, not a guess.
 */
function evaluateFirewallRule(
  probe: ReachabilityProbe,
  active: ProbeConnection[],
  port: number,
): ReachabilityCheck {
  if (active.length === 0) {
    return { id: "firewall_rule", status: "unknown", kind: "advisory", messageKey: "reach.rule_unknown", params: {} };
  }

  const categories = active.map((c) => c.networkCategory);

  const covering = probe.rules.find((rule) =>
    categories.some((category) => profileMatches(rule.profile, category)),
  );
  if (covering) {
    return {
      id: "firewall_rule",
      status: "pass",
      kind: "advisory",
      messageKey: "reach.rule_pass",
      params: { name: covering.displayName },
    };
  }

  // No explicit Allow rule was found. The active profile's own default policy
  // can still mean nothing is blocked — either because that profile has no
  // inbound blocking configured (DefaultInboundAction Allow) or because
  // Windows Firewall is switched off for it entirely.
  const openProfile = probe.firewallProfiles.find(
    (fp) =>
      categories.some((category) => categoryToProfileName(category) === fp.name.toLowerCase()) &&
      (fp.enabled.toLowerCase() === "false" || fp.defaultInboundAction.toLowerCase() === "allow"),
  );
  if (openProfile) {
    return {
      id: "firewall_rule",
      status: "pass",
      kind: "advisory",
      messageKey: "reach.rule_pass_open",
      params: { profile: openProfile.name },
    };
  }

  return { id: "firewall_rule", status: "warn", kind: "advisory", messageKey: "reach.rule_warn", params: { port } };
}

/**
 * Two advisory checks and one proof, in that order. Nothing here ever returns
 * "pass" on evidence the laptop produced about itself — connecting to your own
 * LAN address goes over loopback and never touches an inbound firewall rule, so
 * a self-probe would be false confidence.
 */
export function evaluateReachability(input: EvaluateReachabilityInput): ReachabilityCheck[] {
  const external: ReachabilityCheck = input.externalListenerSeen
    ? { id: "external_hit", status: "pass", kind: "proof", messageKey: "reach.external_pass", params: {} }
    : { id: "external_hit", status: "warn", kind: "proof", messageKey: "reach.external_warn", params: {} };

  if (input.platform !== "win32") {
    return [
      { id: "network_profile", status: "unknown", kind: "advisory", messageKey: "reach.macos", params: {} },
      { id: "firewall_rule", status: "unknown", kind: "advisory", messageKey: "reach.macos", params: {} },
      external,
    ];
  }

  if (!input.probe) {
    return [
      { id: "network_profile", status: "unknown", kind: "advisory", messageKey: "reach.profile_unknown", params: {} },
      { id: "firewall_rule", status: "unknown", kind: "advisory", messageKey: "reach.rule_unknown", params: {} },
      external,
    ];
  }

  const active = input.probe.connections;
  const publicConnection = active.find((c) => c.networkCategory === "Public");

  const profileCheck: ReachabilityCheck = publicConnection
    ? {
        id: "network_profile",
        status: "warn",
        kind: "advisory",
        messageKey: "reach.profile_warn",
        params: { alias: publicConnection.interfaceAlias },
      }
    : active.length === 0
      ? { id: "network_profile", status: "unknown", kind: "advisory", messageKey: "reach.profile_unknown", params: {} }
      : {
          id: "network_profile",
          status: "pass",
          kind: "advisory",
          messageKey: "reach.profile_pass",
          params: { alias: active[0]!.interfaceAlias },
        };

  const ruleCheck = evaluateFirewallRule(input.probe, active, input.port);

  return [profileCheck, ruleCheck, external];
}
