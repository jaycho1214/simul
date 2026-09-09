import { describe, expect, test } from "vitest";
import { ORIGINAL_TAG, S } from "./strings.ts";

const HANGUL = /[가-힣]/;
const LATIN = /[A-Za-z]/;

describe("the bilingual string table", () => {
  test("every chrome string is Korean then English, separated by ' / ', with no script leaking across the divide", () => {
    for (const [key, value] of Object.entries(S)) {
      const parts = value.split(" / ");
      expect(parts.length, `${key} must contain exactly one ' / '`).toBe(2);

      const [korean, english] = parts as [string, string];
      expect(HANGUL.test(korean), `${key} Korean half: ${korean}`).toBe(true);
      expect(
        LATIN.test(korean),
        `${key} Korean half leaks Latin: ${korean}`,
      ).toBe(false);
      expect(LATIN.test(english), `${key} English half: ${english}`).toBe(true);
      expect(
        HANGUL.test(english),
        `${key} English half leaks Hangul: ${english}`,
      ).toBe(false);
      expect(korean.trim(), `${key} Korean half is padded`).toBe(korean);
      expect(english.trim(), `${key} English half is padded`).toBe(english);
    }
  });

  test("carries the spec's exact lane-cap and reconnecting text", () => {
    expect(S.laneCap).toBe(
      "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now",
    );
    expect(S.reconnecting).toBe("재연결 중 / Reconnecting");
  });

  test("the picker's Original tag is the spec's exact text", () => {
    // Written with a middle dot in the spec, so it is deliberately not a
    // ' / ' bilingual string and is excluded from the rule above.
    expect(ORIGINAL_TAG).toBe("원음 · Original");
    expect(Object.values(S)).not.toContain(ORIGINAL_TAG);
  });
});
