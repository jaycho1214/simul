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

export interface ReachabilityCheck {
  id: "network_profile" | "firewall_rule" | "external_hit";
  status: ReachabilityStatus;
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
function profileMatches(rule: string, category: string): boolean {
  const normalised = rule.toLowerCase();
  if (normalised === "any" || normalised === "") return true;
  const wanted = category.toLowerCase() === "domainauthenticated" ? "domain" : category.toLowerCase();
  return normalised.split(/\s*,\s*/).includes(wanted);
}

export interface EvaluateReachabilityInput {
  platform: NodeJS.Platform | string;
  port: number;
  probe: ReachabilityProbe | undefined;
  /** True once any lane on the /admin feed has reported a listener. */
  externalListenerSeen: boolean;
}

/**
 * Two advisory checks and one proof, in that order. Nothing here ever returns
 * "pass" on evidence the laptop produced about itself — connecting to your own
 * LAN address goes over loopback and never touches an inbound firewall rule, so
 * a self-probe would be false confidence.
 */
export function evaluateReachability(input: EvaluateReachabilityInput): ReachabilityCheck[] {
  const external: ReachabilityCheck = input.externalListenerSeen
    ? { id: "external_hit", status: "pass", messageKey: "reach.external_pass", params: {} }
    : { id: "external_hit", status: "warn", messageKey: "reach.external_warn", params: {} };

  if (input.platform !== "win32") {
    return [
      { id: "network_profile", status: "unknown", messageKey: "reach.macos", params: {} },
      { id: "firewall_rule", status: "unknown", messageKey: "reach.macos", params: {} },
      external,
    ];
  }

  if (!input.probe) {
    return [
      { id: "network_profile", status: "unknown", messageKey: "reach.profile_unknown", params: {} },
      { id: "firewall_rule", status: "unknown", messageKey: "reach.rule_unknown", params: {} },
      external,
    ];
  }

  const active = input.probe.connections;
  const publicConnection = active.find((c) => c.networkCategory === "Public");

  const profileCheck: ReachabilityCheck = publicConnection
    ? {
        id: "network_profile",
        status: "warn",
        messageKey: "reach.profile_warn",
        params: { alias: publicConnection.interfaceAlias },
      }
    : active.length === 0
      ? { id: "network_profile", status: "unknown", messageKey: "reach.profile_unknown", params: {} }
      : {
          id: "network_profile",
          status: "pass",
          messageKey: "reach.profile_pass",
          params: { alias: active[0]!.interfaceAlias },
        };

  const categories = active.map((c) => c.networkCategory);
  const covering = input.probe.rules.find((rule) =>
    categories.length === 0
      ? profileMatches(rule.profile, "Private")
      : categories.some((category) => profileMatches(rule.profile, category)),
  );

  const ruleCheck: ReachabilityCheck = covering
    ? {
        id: "firewall_rule",
        status: "pass",
        messageKey: "reach.rule_pass",
        params: { name: covering.displayName },
      }
    : {
        id: "firewall_rule",
        status: "warn",
        messageKey: "reach.rule_warn",
        params: { port: input.port },
      };

  return [profileCheck, ruleCheck, external];
}
