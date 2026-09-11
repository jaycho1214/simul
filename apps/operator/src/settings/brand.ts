/**
 * The brand values, split out from `schema.ts` so the renderer can import
 * them. `schema.ts` reaches `node:crypto` to seed the ingest token, and a
 * renderer module that pulls in a Node builtin does not fail at build time —
 * it fails while Electron is evaluating the module graph, before React
 * mounts, and the operator window comes up black with nothing on screen to
 * say why. Nothing in this file may import a Node builtin.
 * `renderer-imports.test.ts` enforces that from the other direction.
 */

/** Mirrors apps/server's BRAND_THEMES. */
export const BRAND_THEMES = ["dark", "light", "auto"] as const;
export type BrandTheme = (typeof BRAND_THEMES)[number];

/** Mirrors apps/server's LOGO_EXTENSIONS — what BrandRoute can content-type. */
export const LOGO_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"];

/**
 * Mirrors the accent parser in apps/server's src/config.ts: the same tolerant
 * input forms, normalised the same way. It is duplicated rather than shared
 * because the server refuses to start on a bad value while this one has to
 * degrade — but the set of values each accepts must stay identical, or the
 * panel will happily save a colour that stops the server booting.
 */
export function normalizeAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const body = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(body)) {
    const [r, g, b] = body.toLowerCase().split("") as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/i.test(body)) return `#${body.toLowerCase()}`;

  return null;
}

/** True when the path ends in something BrandRoute can actually serve. */
export function isServableLogo(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return LOGO_EXTENSIONS.includes(ext);
}

/**
 * How large a logo may be. The file crosses the IPC bridge as base64 and then
 * lives in a data URI inside the renderer, so this bounds what a preview can
 * reasonably carry rather than what a disk can hold. A venue logo is a few
 * tens of kilobytes; anything near this cap is a photograph by mistake.
 */
export const MAX_LOGO_BYTES = 2_000_000;

const LOGO_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** The extension of a name, lowercased, or "" when it has none. */
function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at === -1 ? "" : name.slice(at).toLowerCase();
}

export function logoMimeType(name: string): string | null {
  return LOGO_MIME[extensionOf(name)] ?? null;
}

/**
 * The name a dropped or picked logo takes inside the app's own storage.
 *
 * The file is copied in rather than referenced where it sits, so an engineer
 * can delete the original, empty their Downloads folder, or move the file
 * between the rehearsal and the event without the attendee app losing its
 * logo. One fixed name per extension means replacing a logo overwrites the
 * old one instead of leaving a directory of dead uploads behind.
 *
 * Only the extension survives from the original name — nothing derived from
 * user input reaches the path, so a name like "../../etc/passwd" has nothing
 * to traverse with.
 */
export function storedLogoName(originalName: string): string | null {
  const ext = extensionOf(originalName);
  return LOGO_MIME[ext] ? `logo${ext}` : null;
}

/** A data URI for an <img src>, from a file name and its base64 contents. */
export function logoDataUri(name: string, base64: string): string | null {
  const mime = logoMimeType(name);
  return mime ? `data:${mime};base64,${base64}` : null;
}

/**
 * A secret rendered so the engineer can confirm *which* key is saved without
 * the key itself being on screen at a sound desk that people walk past. The
 * last four characters are enough to tell two keys apart and are not enough to
 * be worth anything on their own.
 */
export function maskSecret(value: string): string | null {
  if (value === "") return null;
  return value.length < 8 ? "••••••••" : `••••••••${value.slice(-4)}`;
}
