import { describe, expect, test } from "vitest";
import { endonym, languageRows } from "./languages.ts";
import { ORIGINAL_TAG } from "./strings.ts";

describe("endonym", () => {
  test("renders each offered language in its own script", () => {
    expect(endonym("ko")).toBe("한국어");
    expect(endonym("en")).toBe("English");
    expect(endonym("es")).toBe("Español");
    expect(endonym("ja")).toBe("日本語");
  });

  test("falls back to the uppercased code for an unknown language", () => {
    expect(endonym("xx")).toBe("XX");
  });
});

describe("languageRows", () => {
  test("puts the source language first and tags it Original", () => {
    const rows = languageRows({
      offeredLanguages: ["en", "es", "ko", "ja"],
      sourceLanguage: "ko",
    });

    expect(rows[0]).toEqual({
      lang: "ko",
      endonym: "한국어",
      tag: ORIGINAL_TAG,
      isSource: true,
    });
    expect(rows.slice(1).map((r) => r.lang)).toEqual(["en", "es", "ja"]);
    expect(rows.slice(1).every((r) => r.tag === null)).toBe(true);
  });

  test("preserves the configured order of the translated languages", () => {
    const rows = languageRows({
      offeredLanguages: ["ko", "ja", "es", "en"],
      sourceLanguage: "ko",
    });
    expect(rows.map((r) => r.lang)).toEqual(["ko", "ja", "es", "en"]);
  });

  test("drops duplicate language codes", () => {
    const rows = languageRows({
      offeredLanguages: ["ko", "en", "en"],
      sourceLanguage: "ko",
    });
    expect(rows.map((r) => r.lang)).toEqual(["ko", "en"]);
  });
});
