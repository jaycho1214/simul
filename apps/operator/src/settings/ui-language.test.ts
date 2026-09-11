import { describe, expect, test } from "vitest";
import { isUiLanguage, resolveUiLanguage, UI_LANGUAGES } from "./ui-language.ts";

describe("resolveUiLanguage", () => {
  test("an explicit setting wins over the OS locale", () => {
    expect(resolveUiLanguage("en", "ko-KR")).toBe("en");
    expect(resolveUiLanguage("ko", "en-US")).toBe("ko");
  });

  test("with no setting, a Korean OS gets Korean and anything else gets English", () => {
    expect(resolveUiLanguage(null, "ko-KR")).toBe("ko");
    expect(resolveUiLanguage(null, "ko")).toBe("ko");
    expect(resolveUiLanguage(null, "KO-kr")).toBe("ko");
    expect(resolveUiLanguage(null, "en-US")).toBe("en");
    expect(resolveUiLanguage(null, "ja-JP")).toBe("en");
    expect(resolveUiLanguage(null, "")).toBe("en");
  });
});

describe("isUiLanguage", () => {
  test("accepts exactly the two supported codes", () => {
    expect(UI_LANGUAGES).toEqual(["ko", "en"]);
    expect(isUiLanguage("ko")).toBe(true);
    expect(isUiLanguage("en")).toBe(true);
    expect(isUiLanguage("fr")).toBe(false);
    expect(isUiLanguage(null)).toBe(false);
    expect(isUiLanguage(1)).toBe(false);
  });
});
