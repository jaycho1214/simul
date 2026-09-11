import { describe, expect, test } from "vitest";
import {
  evaluateReachability,
  parseReachabilityProbe,
  REACHABILITY_POWERSHELL,
} from "./reachability.ts";

const fullProbe = JSON.stringify({
  connections: [{ InterfaceAlias: "Wi-Fi", NetworkCategory: "Private" }],
  firewallProfiles: [
    { Name: "Private", Enabled: "True", DefaultInboundAction: "Block" },
    { Name: "Public", Enabled: "True", DefaultInboundAction: "Block" },
  ],
  rules: [{ DisplayName: "Simul 8080", Profile: "Private" }],
});

describe("parseReachabilityProbe", () => {
  test("reads the three arrays", () => {
    const probe = parseReachabilityProbe(fullProbe);
    expect(probe.connections).toHaveLength(1);
    expect(probe.firewallProfiles).toHaveLength(2);
    expect(probe.rules).toEqual([{ displayName: "Simul 8080", profile: "Private" }]);
  });

  test("survives PowerShell 5.1 unrolling a single-element array into an object", () => {
    const probe = parseReachabilityProbe(
      JSON.stringify({
        connections: { InterfaceAlias: "Ethernet", NetworkCategory: "Public" },
        firewallProfiles: { Name: "Public", Enabled: "True", DefaultInboundAction: "Block" },
        rules: { DisplayName: "one", Profile: "Any" },
      }),
    );
    expect(probe.connections).toEqual([{ interfaceAlias: "Ethernet", networkCategory: "Public" }]);
    expect(probe.rules).toEqual([{ displayName: "one", profile: "Any" }]);
  });

  test("treats a null array as empty", () => {
    const probe = parseReachabilityProbe(
      JSON.stringify({ connections: [], firewallProfiles: [], rules: null }),
    );
    expect(probe.rules).toEqual([]);
  });

  test("throws on output that is not JSON, so the caller can report 확인 불가", () => {
    expect(() => parseReachabilityProbe("Get-NetFirewallRule : Access denied")).toThrow();
  });
});

describe("REACHABILITY_POWERSHELL", () => {
  test("embeds the port and asks only for read-only cmdlets", () => {
    const script = REACHABILITY_POWERSHELL(8080);
    expect(script).toContain("8080");
    expect(script).toContain("Get-NetConnectionProfile");
    expect(script).toContain("Get-NetFirewallProfile");
    expect(script).toContain("Get-NetFirewallPortFilter");
    expect(script).toContain("ConvertTo-Json");
    // Nothing in the probe may change firewall state.
    expect(script).not.toMatch(/New-NetFirewallRule|Set-Net|Remove-Net|Enable-Net/);
  });
});

describe("evaluateReachability", () => {
  const port = 8080;

  test("all green when the profile is Private, a rule exists and a phone connected", () => {
    const checks = evaluateReachability({
      platform: "win32",
      port,
      probe: parseReachabilityProbe(fullProbe),
      externalListenerSeen: true,
    });
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["network_profile", "pass"],
      ["firewall_rule", "pass"],
      ["external_hit", "pass"],
    ]);
  });

  test("warns when the active network is classified Public", () => {
    const probe = parseReachabilityProbe(
      JSON.stringify({
        connections: [{ InterfaceAlias: "Wi-Fi", NetworkCategory: "Public" }],
        firewallProfiles: [],
        rules: [{ DisplayName: "Simul 8080", Profile: "Private" }],
      }),
    );
    const [profile] = evaluateReachability({
      platform: "win32",
      port,
      probe,
      externalListenerSeen: false,
    });
    expect(profile).toMatchObject({
      id: "network_profile",
      status: "warn",
      messageKey: "reach.profile_warn",
      params: { alias: "Wi-Fi" },
    });
  });

  test("a Private rule does not satisfy a Public active profile", () => {
    const probe = parseReachabilityProbe(
      JSON.stringify({
        connections: [{ InterfaceAlias: "Wi-Fi", NetworkCategory: "Public" }],
        firewallProfiles: [],
        rules: [{ DisplayName: "Simul 8080", Profile: "Private" }],
      }),
    );
    const checks = evaluateReachability({
      platform: "win32",
      port,
      probe,
      externalListenerSeen: false,
    });
    expect(checks[1]).toMatchObject({ id: "firewall_rule", status: "warn" });
  });

  test("a rule scoped to Any covers whichever profile is active", () => {
    const probe = parseReachabilityProbe(
      JSON.stringify({
        connections: [{ InterfaceAlias: "Wi-Fi", NetworkCategory: "Public" }],
        firewallProfiles: [],
        rules: [{ DisplayName: "any-profile", Profile: "Any" }],
      }),
    );
    const checks = evaluateReachability({
      platform: "win32",
      port,
      probe,
      externalListenerSeen: false,
    });
    expect(checks[1]).toMatchObject({ id: "firewall_rule", status: "pass" });
  });

  test("warns when no inbound allow rule was found at all", () => {
    const probe = parseReachabilityProbe(
      JSON.stringify({
        connections: [{ InterfaceAlias: "Wi-Fi", NetworkCategory: "Private" }],
        firewallProfiles: [],
        rules: [],
      }),
    );
    const checks = evaluateReachability({
      platform: "win32",
      port,
      probe,
      externalListenerSeen: false,
    });
    expect(checks[1]).toMatchObject({
      id: "firewall_rule",
      status: "warn",
      messageKey: "reach.rule_warn",
      params: { port: 8080 },
    });
  });

  test("an undefined probe reports unknown rather than pass", () => {
    const checks = evaluateReachability({
      platform: "win32",
      port,
      probe: undefined,
      externalListenerSeen: false,
    });
    expect(checks.slice(0, 2).map((c) => c.status)).toEqual(["unknown", "unknown"]);
  });

  test("on macOS the Windows checks are reported as not applicable, never as pass", () => {
    const checks = evaluateReachability({
      platform: "darwin",
      port,
      probe: undefined,
      externalListenerSeen: false,
    });
    expect(checks.slice(0, 2)).toEqual([
      {
        id: "network_profile",
        status: "unknown",
        kind: "advisory",
        messageKey: "reach.macos",
        params: {},
      },
      {
        id: "firewall_rule",
        status: "unknown",
        kind: "advisory",
        messageKey: "reach.macos",
        params: {},
      },
    ]);
  });

  test("the external-hit check is the only one that ever proves anything", () => {
    const checks = evaluateReachability({
      platform: "darwin",
      port,
      probe: undefined,
      externalListenerSeen: true,
    });
    expect(checks[2]).toEqual({
      id: "external_hit",
      status: "pass",
      kind: "proof",
      messageKey: "reach.external_pass",
      params: {},
    });

    // The field exists so a UI cannot render an advisory as though it were
    // proof. Assert the distinction directly, or it can regress silently.
    expect(checks.map((c) => c.kind)).toEqual(["advisory", "advisory", "proof"]);
  });
});
