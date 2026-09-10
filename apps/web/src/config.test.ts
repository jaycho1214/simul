import { describe, expect, test, vi } from "vitest";
import { fetchConfig, parseConfig, serverBaseUrls } from "./config.ts";

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
        sourceLanguage: "ko",
        transcriptDelayMs: 1500,
      }),
    ).toEqual({
      offeredLanguages: ["ko", "en", "es", "ja"],
      sourceLanguage: "ko",
      transcriptDelayMs: 1500,
    });
  });

  test("defaults transcriptDelayMs to 0 when absent", () => {
    const config = parseConfig({
      offeredLanguages: ["ko"],
      sourceLanguage: "ko",
    });
    expect(config.transcriptDelayMs).toBe(0);
  });

  test("rejects an empty language list", () => {
    expect(() =>
      parseConfig({ offeredLanguages: [], sourceLanguage: "ko" }),
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
      sourceLanguage: "ko",
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
