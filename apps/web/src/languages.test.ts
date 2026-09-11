import { describe, expect, test } from "vitest";
import { endonym, languageRows, muteLabels } from "./languages.ts";
import { PASSTHROUGH_TAG, S } from "./strings.ts";

describe("endonym", () => {
  test("renders each offered language in its own script", () => {
    expect(endonym("ko")).toBe("한국어");
    expect(endonym("en")).toBe("English");
    expect(endonym("es")).toBe("Español");
    expect(endonym("ja")).toBe("日本語");
  });

  test("names a regional code by its script, not its code", () => {
    // These were "ZH-CN" and "ZH-TW" on the phones before the picker shared
    // the operator's table.
    expect(endonym("zh-CN")).toBe("简体中文");
    expect(endonym("zh-TW")).toBe("繁體中文");
  });

  test("a regional variant the table lacks lands on the language itself", () => {
    expect(endonym("pt-BR")).toBe("Português");
  });

  test("names the passthrough lane as the room's own sound", () => {
    expect(endonym("original")).toBe("원음");
  });

  test("asks the browser for a language the table has never heard of", () => {
    expect(endonym("yo")).toBe(new Intl.DisplayNames(["yo"], { type: "language" }).of("yo"));
  });

  test("falls back to the uppercased code for an unknown language", () => {
    expect(endonym("xx")).toBe("XX");
  });
});

describe("muteLabels", () => {
  test("is in the language the reader chose", () => {
    expect(muteLabels("ja")).toEqual({ mute: "ミュート", unmute: "ミュート解除" });
    expect(muteLabels("zh-CN")).toEqual({ mute: "静音", unmute: "取消静音" });
    expect(muteLabels("ko")).toEqual({ mute: "음소거", unmute: "소리 켜기" });
    expect(muteLabels("en")).toEqual({ mute: "Mute", unmute: "Unmute" });
  });

  test("a regional variant uses the language's words", () => {
    expect(muteLabels("pt-BR")).toEqual(muteLabels("pt"));
  });

  test("falls back to the Korean/English pair for the passthrough lane and unknown codes", () => {
    expect(muteLabels("original")).toEqual({ mute: S.mute, unmute: S.unmute });
    expect(muteLabels("xx")).toEqual({ mute: S.mute, unmute: S.unmute });
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
