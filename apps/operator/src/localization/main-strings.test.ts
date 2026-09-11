import { describe, expect, test } from "vitest";
import { MAIN_STRINGS, mainStrings } from "./main-strings.ts";

describe("main-process strings", () => {
  test("both languages carry the same keys", () => {
    expect(Object.keys(MAIN_STRINGS.en).sort()).toEqual(Object.keys(MAIN_STRINGS.ko).sort());
  });

  test("the logo messages interpolate their argument", () => {
    expect(mainStrings("en").logoTooLarge(2)).toContain("2MB");
    expect(mainStrings("ko").logoTooLarge(2)).toContain("2MB");
    expect(mainStrings("en").logoUnsupported("x.bmp")).toContain("x.bmp");
    expect(mainStrings("ko").logoUnsupported("x.bmp")).toContain("x.bmp");
  });

  test("the English table has no Hangul and the Korean table no English sentences", () => {
    const en = Object.values(MAIN_STRINGS.en).map((v) =>
      typeof v === "function" ? v("f" as never) : v,
    );
    expect(en.some((s) => /[가-힣]/.test(String(s)))).toBe(false);
    expect(MAIN_STRINGS.ko.quitTitle).toBe("통역 종료");
  });
});
