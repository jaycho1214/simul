import { describe, expect, test } from "vitest";
import {
  GEMINI_LANGUAGES,
  isLanguageCode,
  languageLabel,
  languagesPendingRemoval,
} from "./languages.ts";

describe("GEMINI_LANGUAGES", () => {
  test("covers every language Google's live-translate page names explicitly", () => {
    // From ai.google.dev/gemini-api/docs/live-api/live-translate, which names
    // these as examples of the 70+ it supports. Anything else in the list is a
    // reasonable guess, which is why the panel also takes a typed code.
    for (const code of ["en", "es", "fr", "de", "zh-CN", "zh-TW", "ja", "af", "kk", "km", "zu"]) {
      expect(
        GEMINI_LANGUAGES.some((l) => l.code === code),
        code,
      ).toBe(true);
    }
  });

  test("has no duplicate codes", () => {
    const codes = GEMINI_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("names every language in its own script, for the attendee picker", () => {
    for (const l of GEMINI_LANGUAGES) {
      expect(l.endonym.length, l.code).toBeGreaterThan(0);
      expect(l.ko.length, l.code).toBeGreaterThan(0);
    }
  });

  test("includes Korean, the speaker's language for this system", () => {
    expect(GEMINI_LANGUAGES.find((l) => l.code === "ko")?.endonym).toBe("한국어");
  });
});

describe("isLanguageCode", () => {
  test.each(["en", "ko", "zh-CN", "pt-BR", "fil"])("accepts %j", (code) => {
    expect(isLanguageCode(code)).toBe(true);
  });

  // The panel lets an engineer type a code the curated list is missing, so
  // this is the only thing standing between a typo and a lane the server
  // cannot open.
  test.each(["", "e", "english", "en_US", "en-", "../x", "en US", "toolongcode"])(
    "refuses %j",
    (code) => {
      expect(isLanguageCode(code)).toBe(false);
    },
  );
});

describe("languageLabel", () => {
  test("names a known language in both scripts", () => {
    expect(languageLabel("ja")).toBe("日本語 · 일본어");
  });

  // An operator can type a valid code the list does not carry. Showing the
  // raw code is honest; inventing a name for it would not be.
  test("falls back to the bare code for one it does not know", () => {
    expect(languageLabel("xh-ZA")).toBe("xh-ZA");
  });
});

describe("languagesPendingRemoval", () => {
  test("is what the server serves that the saved list dropped, in the server's order", () => {
    expect(languagesPendingRemoval(["en", "vi"], ["ko", "en", "ja", "vi"])).toEqual(["ko", "ja"]);
  });

  test("an addition is never pending: the server takes it live", () => {
    expect(languagesPendingRemoval(["ko", "en", "vi"], ["ko", "en"])).toEqual([]);
  });

  test("nothing is pending while the server is down", () => {
    expect(languagesPendingRemoval(["en"], undefined)).toEqual([]);
  });
});
