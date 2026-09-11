import { describe, expect, test } from "vitest";
import { endonym, languageRows } from "./languages.ts";
import { PASSTHROUGH_TAG } from "./strings.ts";

describe("endonym", () => {
  test("renders each offered language in its own script", () => {
    expect(endonym("ko")).toBe("한국어");
    expect(endonym("en")).toBe("English");
    expect(endonym("es")).toBe("Español");
    expect(endonym("ja")).toBe("日本語");
  });

  test("names the passthrough lane as the room's own sound", () => {
    expect(endonym("original")).toBe("원음");
  });

  test("falls back to the uppercased code for an unknown language", () => {
    expect(endonym("xx")).toBe("XX");
  });
});

describe("languageRows", () => {
  // There is no "speaker's own language" row any more: every language is a
  // translation and the model detects what is spoken, so nothing is promoted
  // or tagged and the server's order is the reader's order.
  test("lists the offered languages in the server's order, none of them tagged", () => {
    const rows = languageRows({
      offeredLanguages: ["en", "es", "ko", "ja"],
      passthroughLanguage: null,
    });

    expect(rows.map((r) => r.lang)).toEqual(["en", "es", "ko", "ja"]);
    expect(rows.every((r) => r.tag === null && !r.isPassthrough)).toBe(true);
    expect(rows[2]).toEqual({ lang: "ko", endonym: "한국어", tag: null, isPassthrough: false });
  });

  test("appends the passthrough lane last, tagged as debug, when the operator turned it on", () => {
    const rows = languageRows({
      offeredLanguages: ["ko", "en"],
      passthroughLanguage: "original",
    });

    expect(rows.map((r) => r.lang)).toEqual(["ko", "en", "original"]);
    expect(rows[2]).toEqual({
      lang: "original",
      endonym: "원음",
      tag: PASSTHROUGH_TAG,
      isPassthrough: true,
    });
  });

  test("drops duplicate language codes", () => {
    const rows = languageRows({
      offeredLanguages: ["ko", "en", "en"],
      passthroughLanguage: null,
    });
    expect(rows.map((r) => r.lang)).toEqual(["ko", "en"]);
  });
});
