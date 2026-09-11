import { useEffect } from "react";
import { GROUND, accentTokens } from "./brand.ts";
import { resolveScheme, type Brand } from "./config.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Paints the operator's brand onto the document: the derived accent tokens,
 * the scheme the stylesheet keys its palette off, and the browser chrome
 * colour behind the notch.
 *
 * The stylesheet already ships a complete default for every one of these, so
 * this only ever overrides — a page whose /config never arrives is unbranded,
 * not unstyled.
 */
export function applyBrand(
  doc: Document,
  brand: Brand,
  prefersDark: boolean,
  reader: "light" | "dark" | null = null,
): void {
  const scheme = resolveScheme(brand.theme, prefersDark, reader);
  const root = doc.documentElement;

  for (const [name, value] of Object.entries(accentTokens(brand.accent, scheme))) {
    root.style.setProperty(name, value);
  }
  root.setAttribute("data-theme", scheme);

  let meta = doc.head.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement("meta");
    meta.setAttribute("name", "theme-color");
    doc.head.appendChild(meta);
  }
  meta.setAttribute("content", GROUND[scheme]);
}

/**
 * Keeps the page in step with the brand and, on `auto`, with the device
 * switching itself between light and dark mid-session — which on iOS happens
 * on a schedule, and so will happen during an evening event.
 */
export function useBrand(brand: Brand, reader: "light" | "dark" | null = null): void {
  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY);
    const paint = () => applyBrand(document, brand, media?.matches ?? false, reader);

    paint();
    // Only worth listening while the page is actually following the device:
    // an explicit choice, by either the operator or the reader, does not move
    // when the phone switches itself to dark at sunset.
    if (!media || brand.theme !== "auto" || reader !== null) return;

    media.addEventListener("change", paint);
    return () => media.removeEventListener("change", paint);
  }, [brand, reader]);
}
