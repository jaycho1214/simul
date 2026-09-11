import { afterEach, describe, expect, test } from "vitest";
import { GROUND, accentTokens } from "./brand.ts";
import { UNBRANDED } from "./config.ts";
import { applyBrand } from "./use-brand.ts";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});

const root = () => document.documentElement;

describe("applyBrand", () => {
  test("writes every accent token onto the document root", () => {
    applyBrand(document, { ...UNBRANDED, accent: "#7a3e9d", theme: "dark" }, false);

    for (const [name, value] of Object.entries(accentTokens("#7a3e9d", "dark"))) {
      expect(root().style.getPropertyValue(name), name).toBe(value);
    }
  });

  test("stamps the resolved scheme so the stylesheet can switch palettes", () => {
    applyBrand(document, { ...UNBRANDED, theme: "light" }, false);
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  test("resolves auto against the device preference", () => {
    applyBrand(document, { ...UNBRANDED, theme: "auto" }, true);
    expect(root().getAttribute("data-theme")).toBe("dark");

    applyBrand(document, { ...UNBRANDED, theme: "auto" }, false);
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  // The colour behind the notch and the pull-to-refresh overscroll. Left at
  // the dark default on a light-themed page, it frames the whole app in a
  // black band on iOS.
  test("repaints the browser chrome to match the resolved ground", () => {
    applyBrand(document, { ...UNBRANDED, theme: "light" }, false);
    const meta = document.head.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute("content")).toBe(GROUND.light);
  });

  test("reuses an existing theme-color tag rather than stacking duplicates", () => {
    applyBrand(document, { ...UNBRANDED, theme: "dark" }, false);
    applyBrand(document, { ...UNBRANDED, theme: "light" }, false);

    const all = document.head.querySelectorAll('meta[name="theme-color"]');
    expect(all).toHaveLength(1);
    expect(all[0]!.getAttribute("content")).toBe(GROUND.light);
  });

  test("derives the accent against the scheme actually being painted", () => {
    // #ffffff is invisible on the light ground and must be darkened there,
    // while on dark it can be left alone. Same input, different output.
    applyBrand(document, { ...UNBRANDED, accent: "#ffffff", theme: "light" }, false);
    const light = root().style.getPropertyValue("--accent");

    applyBrand(document, { ...UNBRANDED, accent: "#ffffff", theme: "dark" }, false);
    expect(root().style.getPropertyValue("--accent")).not.toBe(light);
  });
});
