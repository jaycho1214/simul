import { describe, expect, test } from "vitest";
import { joinUrl, pickLanAddresses, type NetworkInterfaceMap } from "./lan-ip.ts";

const ipv4 = (address: string, internal = false) => ({
  address,
  family: "IPv4" as const,
  internal,
  mac: "00:00:00:00:00:00",
  netmask: "255.255.255.0",
});

describe("pickLanAddresses", () => {
  test("returns nothing when only loopback is present", () => {
    const interfaces: NetworkInterfaceMap = { lo0: [ipv4("127.0.0.1", true)] };
    expect(pickLanAddresses(interfaces)).toEqual([]);
  });

  test("skips IPv6 entirely — the QR carries an IPv4 URL", () => {
    const interfaces: NetworkInterfaceMap = {
      en0: [
        { address: "fe80::1", family: "IPv6", internal: false, mac: "", netmask: "" },
        ipv4("192.168.1.42"),
      ],
    };
    expect(pickLanAddresses(interfaces).map((a) => a.address)).toEqual(["192.168.1.42"]);
  });

  test("ranks a real private address above a virtual adapter", () => {
    const interfaces: NetworkInterfaceMap = {
      "vEthernet (Default Switch)": [ipv4("172.20.16.1")],
      "Wi-Fi": [ipv4("192.168.1.42")],
    };
    expect(pickLanAddresses(interfaces).map((a) => a.address)).toEqual([
      "192.168.1.42",
      "172.20.16.1",
    ]);
  });

  test("ranks a link-local APIPA address last", () => {
    const interfaces: NetworkInterfaceMap = {
      Ethernet: [ipv4("169.254.10.4")],
      "Wi-Fi": [ipv4("10.0.0.9")],
    };
    expect(pickLanAddresses(interfaces).map((a) => a.address)).toEqual([
      "10.0.0.9",
      "169.254.10.4",
    ]);
  });

  test("classifies each address", () => {
    const interfaces: NetworkInterfaceMap = {
      "Wi-Fi": [ipv4("192.168.1.42")],
      utun3: [ipv4("100.64.0.2")],
      Ethernet: [ipv4("169.254.10.4")],
    };
    const byName = Object.fromEntries(
      pickLanAddresses(interfaces).map((a) => [a.interfaceName, a]),
    );
    expect(byName["Wi-Fi"]).toMatchObject({ kind: "private", virtual: false });
    expect(byName["utun3"]).toMatchObject({ kind: "other", virtual: true });
    expect(byName["Ethernet"]).toMatchObject({ kind: "link-local", virtual: false });
  });

  test("recognises every private range the RFC defines", () => {
    const interfaces: NetworkInterfaceMap = {
      a: [ipv4("10.1.2.3")],
      b: [ipv4("172.16.0.1")],
      c: [ipv4("172.31.255.254")],
      d: [ipv4("192.168.0.1")],
      e: [ipv4("172.32.0.1")],
    };
    const kinds = Object.fromEntries(
      pickLanAddresses(interfaces).map((a) => [a.interfaceName, a.kind]),
    );
    expect(kinds).toEqual({
      a: "private",
      b: "private",
      c: "private",
      d: "private",
      e: "other",
    });
  });

  test("names the usual virtual adapters on both platforms", () => {
    const virtualNames = [
      "vEthernet (WSL)",
      "VirtualBox Host-Only Network",
      "VMware Network Adapter VMnet1",
      "docker0",
      "bridge100",
      "utun0",
      "awdl0",
      "llw0",
      "Tailscale",
      "ZeroTier One [abc]",
    ];
    const interfaces: NetworkInterfaceMap = Object.fromEntries(
      virtualNames.map((name, i) => [name, [ipv4(`192.168.9.${i + 1}`)]]),
    );
    expect(pickLanAddresses(interfaces).every((a) => a.virtual)).toBe(true);
  });

  test("is stable for equally-ranked interfaces", () => {
    const interfaces: NetworkInterfaceMap = {
      "Wi-Fi": [ipv4("192.168.1.42")],
      Ethernet: [ipv4("192.168.1.43")],
    };
    expect(pickLanAddresses(interfaces).map((a) => a.address)).toEqual([
      "192.168.1.42",
      "192.168.1.43",
    ]);
  });

  test("handles an interface entry that is undefined", () => {
    const interfaces: NetworkInterfaceMap = { "Wi-Fi": undefined, en0: [ipv4("10.0.0.5")] };
    expect(pickLanAddresses(interfaces).map((a) => a.address)).toEqual(["10.0.0.5"]);
  });
});

describe("joinUrl", () => {
  test("is the spec's http://<lan-ip>:8080", () => {
    expect(joinUrl("192.168.1.42", 8080)).toBe("http://192.168.1.42:8080");
  });

  test("keeps a non-default port", () => {
    expect(joinUrl("10.0.0.5", 9000)).toBe("http://10.0.0.5:9000");
  });
});
