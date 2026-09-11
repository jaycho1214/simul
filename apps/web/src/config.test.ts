import { describe, expect, test, vi } from "vitest";
import { DEFAULT_ACCENT } from "./brand.ts";
import {
  UNBRANDED,
  fetchConfig,
  parseConfig,
  resolveScheme,
  serverBaseUrls,
} from "./config.ts";

function stubFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("parseConfig", () => {
  test("accepts the server's /config payload", () => {
    expect(
      parseConfig({
        offeredLanguages: ["ko", "en", "es", "ja"],
        passthroughLanguage: "original",
        transcriptDelayMs: 1500,
        streamPrimeMs: 3072,
      }),
    ).toEqual({
      offeredLanguages: ["ko", "en", "es", "ja"],
      passthroughLanguage: "original",
      transcriptDelayMs: 1500,
      streamPrimeMs: 3072,
      live: false,
      brand: UNBRANDED,
    });
  });

  test("defaults transcriptDelayMs to 0 when absent", () => {
    const config = parseConfig({
      offeredLanguages: ["ko"],
    });
    expect(config.transcriptDelayMs).toBe(0);
  });

  test("rejects an empty language list", () => {
    expect(() =>
      parseConfig({ offeredLanguages: [] }),
    ).toThrow(/offeredLanguages/);
  });

  test("rejects a negative transcript delay", () => {
    expect(() =>
      parseConfig({
        offeredLanguages: ["ko"],
        sourceLanguage: "ko",
        transcriptDelayMs: -1,
      }),
    ).toThrow(/transcriptDelayMs/);
  });
});

describe("fetchConfig", () => {
  test("reads /config from the given origin", async () => {
    const fetchImpl = stubFetch({
      offeredLanguages: ["ko", "en"],
      transcriptDelayMs: 0,
    });

    const config = await fetchConfig("http://192.168.1.4:8080", fetchImpl);

    expect(config.offeredLanguages).toEqual(["ko", "en"]);
    // A wrong path or a dropped no-store here would connect the phone
    // nowhere, silently — indistinguishable from a venue wifi problem.
    expect(fetchImpl).toHaveBeenCalledWith("http://192.168.1.4:8080/config", {
      cache: "no-store",
    });
  });

  test("throws on a non-OK response", async () => {
    await expect(
      fetchConfig("http://192.168.1.4:8080", stubFetch({}, 503)),
    ).rejects.toThrow(/503/);
  });

  test("propagates a malformed JSON body instead of swallowing it", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchConfig("http://192.168.1.4:8080", fetchImpl),
    ).rejects.toThrow();
  });

  test("propagates a network failure instead of swallowing it", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;

    await expect(
      fetchConfig("http://192.168.1.4:8080", fetchImpl),
    ).rejects.toThrow(/network unreachable/);
  });
});

describe("serverBaseUrls", () => {
  test("derives http and ws origins from the page location", () => {
    expect(
      serverBaseUrls({ protocol: "http:", host: "192.168.1.4:8080" }),
    ).toEqual({
      http: "http://192.168.1.4:8080",
      ws: "ws://192.168.1.4:8080",
    });
  });

  test("upgrades to wss when the page is somehow served over https", () => {
    expect(serverBaseUrls({ protocol: "https:", host: "x.example" }).ws).toBe(
      "wss://x.example",
    );
  });
});

/**
 * The core fields throw when malformed, because a client that cannot read the
 * language list has nothing to show. Brand is the opposite: it is decoration
 * over a working app, so every bad value degrades to the unbranded default.
 * An operator's typo in a colour must never be why a hall full of phones shows
 * an error screen.
 */
describe("parseConfig brand", () => {
  const core = { offeredLanguages: ["ko"] };

  test("reads a fully specified brand", () => {
    expect(
      parseConfig({
        ...core,
        brand: {
          name: "주일 예배",
          accent: "#7A3E9D",
          logoUrl: "/brand/logo",
          theme: "light",
        },
      }).brand,
    ).toEqual({
      name: "주일 예배",
      accent: "#7A3E9D",
      logoUrl: "/brand/logo",
      theme: "light",
    });
  });

  test("defaults the whole block when it is absent", () => {
    expect(parseConfig(core).brand).toEqual({
      name: null,
      accent: DEFAULT_ACCENT,
      logoUrl: null,
      theme: "dark",
    });
  });

  test("falls back to the default accent rather than throwing", () => {
    expect(parseConfig({ ...core, brand: { accent: "puce" } }).brand.accent).toBe(
      DEFAULT_ACCENT,
    );
  });

  test("falls back to the dark theme for an unknown value", () => {
    expect(parseConfig({ ...core, brand: { theme: "sepia" } }).brand.theme).toBe(
      "dark",
    );
  });

  test("treats an empty name as unbranded", () => {
    expect(parseConfig({ ...core, brand: { name: "  " } }).brand.name).toBeNull();
  });

  // The logo is rendered into an <img> on a page served over plain HTTP. A
  // logoUrl pointing anywhere but this server's own path would let a bad
  // /config turn every attendee's phone into a beacon for a third-party host.
  test.each([
    "https://evil.example/pixel.gif",
    "//evil.example/pixel.gif",
    "data:image/gif;base64,R0lGOD",
    "javascript:alert(1)",
    "brand/logo",
  ])("refuses an off-origin logo url %j", (url) => {
    expect(parseConfig({ ...core, brand: { logoUrl: url } }).brand.logoUrl).toBeNull();
  });
});

describe("resolveScheme", () => {
  test("uses the configured scheme when it is not auto", () => {
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("dark", false)).toBe("dark");
  });

  test("follows the device on auto", () => {
    expect(resolveScheme("auto", true)).toBe("dark");
    expect(resolveScheme("auto", false)).toBe("light");
  });
});

// The prime is how far behind live the plain-<audio> fallback starts, and the
// controller's "this far behind is a stall, rejoin" threshold is sized from it.
// An older server that does not send it must still load: "unknown" reads as 0,
// which leaves that threshold at its floor rather than refusing the page.
describe("parseConfig streamPrimeMs", () => {
  test("defaults to 0 when absent", () => {
    const config = parseConfig({ offeredLanguages: ["ko"] });
    expect(config.streamPrimeMs).toBe(0);
  });

  test("rejects a negative prime", () => {
    expect(() =>
      parseConfig({ offeredLanguages: ["ko"], streamPrimeMs: -1 }),
    ).toThrow(/streamPrimeMs/);
  });
});

// The passthrough lane is a debugging aid the operator switches on; a normal
// event's /config says nothing about it, and the page must read that as "no
// such row" rather than fail.
describe("parseConfig passthroughLanguage", () => {
  test("is null when the server sends none", () => {
    expect(parseConfig({ offeredLanguages: ["ko"] }).passthroughLanguage).toBeNull();
    expect(parseConfig({ offeredLanguages: ["ko"], passthroughLanguage: null }).passthroughLanguage).toBeNull();
    expect(parseConfig({ offeredLanguages: ["ko"], passthroughLanguage: "" }).passthroughLanguage).toBeNull();
  });

  test("carries the lane code when the operator turned the lane on", () => {
    expect(parseConfig({ offeredLanguages: ["ko"], passthroughLanguage: "original" }).passthroughLanguage).toBe("original");
  });
});

describe("parseConfig live", () => {
  const core = { offeredLanguages: ["en"], passthroughLanguage: null };

  test("reads the room's live state", () => {
    expect(parseConfig({ ...core, live: true }).live).toBe(true);
  });

  // Treating an absent or malformed flag as "live" would let an early arrival
  // tap a language and open a billed session against an empty room; treating
  // it as "not live" only makes them wait for the next poll.
  test.each([undefined, null, "yes", 1])("treats %j as not live", (bad) => {
    expect(parseConfig({ ...core, live: bad }).live).toBe(false);
  });
});
