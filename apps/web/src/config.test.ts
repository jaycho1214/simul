import { describe, expect, test } from "vitest";
import { fetchConfig, parseConfig, serverBaseUrls } from "./config.ts";

function stubFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
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
    const config = await fetchConfig(
      "http://192.168.1.4:8080",
      stubFetch({
        offeredLanguages: ["ko", "en"],
        sourceLanguage: "ko",
        transcriptDelayMs: 0,
      }),
    );
    expect(config.offeredLanguages).toEqual(["ko", "en"]);
  });

  test("throws on a non-OK response", async () => {
    await expect(
      fetchConfig("http://192.168.1.4:8080", stubFetch({}, 503)),
    ).rejects.toThrow(/503/);
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
