import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  BLACK,
  DEFAULT_ACCENT,
  GROUND,
  WHITE,
  accentTokens,
  contrastRatio,
  fromOklch,
  luminance,
  parseHex,
  toOklch,
} from "./brand.ts";

describe("parseHex", () => {
  test("reads a six-digit hex colour", () => {
    expect(parseHex("#3E8FD0")).toEqual({ r: 0x3e, g: 0x8f, b: 0xd0 });
  });

  test("expands three-digit shorthand", () => {
    expect(parseHex("#f80")).toEqual({ r: 0xff, g: 0x88, b: 0x00 });
  });

  test("accepts a value with no leading hash", () => {
    expect(parseHex("3e8fd0")).toEqual({ r: 0x3e, g: 0x8f, b: 0xd0 });
  });

  // An operator typing into a .env file is the only source of these, so every
  // near-miss returns null and lets the caller fall back rather than throwing
  // into a render.
  test.each(["", "#12345", "#ggghhh", "rgb(1,2,3)", "#1234567"])(
    "rejects %j",
    (bad) => {
      expect(parseHex(bad)).toBeNull();
    },
  );
});

describe("contrastRatio", () => {
  test("black against white is the 21:1 maximum", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 2);
  });

  test("is symmetric", () => {
    const a = parseHex("#3E8FD0")!;
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });

  test("a colour against itself is 1:1", () => {
    expect(contrastRatio(BLACK, BLACK)).toBeCloseTo(1, 10);
  });
});

describe("oklch round-trip", () => {
  test.each(["#3E8FD0", "#FFD400", "#000080", "#FFFFFF", "#000000", "#7A3E9D"])(
    "%s survives a conversion in both directions",
    (hex) => {
      const rgb = parseHex(hex)!;
      const back = fromOklch(toOklch(rgb));
      expect(back).toEqual(rgb);
    },
  );
});

/**
 * The operator types one hex value into a .env file and never sees the
 * attendee's screen. These are the guarantees that make that safe: whatever
 * they pick, the accent stays visible against the ground it sits on and text
 * on top of it stays readable. The sweep is deliberately full of bad choices —
 * neon yellow, near-black navy, pure white.
 */
const AWKWARD = [
  "#FFD400", // neon yellow: white text on it is unreadable
  "#000080", // navy: invisible on the dark ground
  "#FFFFFF", // white: invisible on the light ground
  "#000000",
  "#FF0000",
  "#00FF00",
  "#3E8FD0",
  "#7A3E9D",
  "#8B4513",
];

describe("accentTokens", () => {
  // 3:1 is the WCAG threshold for a UI component boundary, which is what the
  // accent is used as: a marker rule, a focus ring, a filled button.
  test.each(AWKWARD)("%s stays visible against the dark ground", (hex) => {
    const t = accentTokens(hex, "dark");
    const ratio = contrastRatio(parseHex(t["--accent"])!, parseHex(GROUND.dark)!);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  test.each(AWKWARD)("%s stays visible against the light ground", (hex) => {
    const t = accentTokens(hex, "light");
    const ratio = contrastRatio(parseHex(t["--accent"])!, parseHex(GROUND.light)!);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  /**
   * `--accent` only promises to be *visible* on the ground (3:1, the bar for a
   * rule or a filled shape). The tag chip and the muted button set small words
   * in the accent colour directly on the page, and words need 4.5:1 — so there
   * is a second, further-pushed token for exactly that job.
   */
  test.each(AWKWARD)("%s carries small text on the dark ground", (hex) => {
    const t = accentTokens(hex, "dark");
    expect(
      contrastRatio(parseHex(t["--accent-text"])!, parseHex(GROUND.dark)!),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test.each(AWKWARD)("%s carries small text on the light ground", (hex) => {
    const t = accentTokens(hex, "light");
    expect(
      contrastRatio(parseHex(t["--accent-text"])!, parseHex(GROUND.light)!),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("keeps the text accent on the operator's hue", () => {
    const before = toOklch(parseHex("#e8b64c")!);
    const after = toOklch(parseHex(accentTokens("#e8b64c", "light")["--accent-text"])!);
    expect(Math.abs(after.h - before.h)).toBeLessThan(5);
  });

  test("lightens a near-black accent on the dark ground", () => {
    const t = accentTokens("#000080", "dark");
    expect(luminance(parseHex(t["--accent"])!)).toBeGreaterThan(
      luminance(parseHex("#000080")!),
    );
  });

  test("darkens a near-white accent on the light ground", () => {
    const t = accentTokens("#FFFFF0", "light");
    expect(luminance(parseHex(t["--accent"])!)).toBeLessThan(
      luminance(parseHex("#FFFFF0")!),
    );
  });

  // Lightening by blending toward white would wash the hue out; the whole
  // reason the conversion above exists is that an operator's blue must still
  // read as their blue after it has been made visible.
  test("preserves the operator's hue while adjusting lightness", () => {
    const before = toOklch(parseHex("#000080")!);
    const after = toOklch(parseHex(accentTokens("#000080", "dark")["--accent"])!);
    expect(Math.abs(after.h - before.h)).toBeLessThan(5);
  });

  test("falls back to the default accent when the value is unparseable", () => {
    expect(accentTokens("not a colour", "dark")).toEqual(
      accentTokens(DEFAULT_ACCENT, "dark"),
    );
  });
});

/**
 * GROUND is a copy of two values that really live in the stylesheet, and every
 * contrast guarantee above is measured against it. A drifting copy would not
 * break a single test — it would just quietly start certifying the accent
 * against a background the page no longer has.
 */
describe("GROUND", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  function declaredGround(block: string): string {
    const scope = css.slice(css.indexOf(block));
    return /--ground:\s*(#[0-9a-f]{6})/i.exec(scope)![1]!.toLowerCase();
  }

  test("matches the dark ground painted by styles.css", () => {
    expect(declaredGround(":root {")).toBe(GROUND.dark);
  });

  test("matches the light ground painted by styles.css", () => {
    expect(declaredGround(':root[data-theme="light"] {')).toBe(GROUND.light);
  });
});
