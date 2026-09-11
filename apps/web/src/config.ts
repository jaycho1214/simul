import { DEFAULT_ACCENT, parseHex } from "./brand.ts";

export type Theme = "dark" | "light" | "auto";

export interface Brand {
  /** The event's name, or null when the operator left it unset. */
  name: string | null;
  /** A six-digit hex colour, already known to parse. */
  accent: string;
  /** A same-origin absolute path, or null when no logo is configured. */
  logoUrl: string | null;
  theme: Theme;
}

export const UNBRANDED: Brand = Object.freeze({
  name: null,
  accent: DEFAULT_ACCENT,
  logoUrl: null,
  // Matches the server's own default so the paint before /config answers is
  // the same scheme as the one after it: a phone in light mode would
  // otherwise flash dark for a moment on every load.
  theme: "auto",
});

const THEMES: readonly Theme[] = ["dark", "light", "auto"];

function brandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Only a same-origin absolute path is allowed through. The value ends up as an
 * <img src>, so anything scheme-relative, absolute or exotic would have every
 * phone in the hall fetch from a host this system does not control — and on a
 * plain-HTTP venue LAN that is exactly the request nobody can vet.
 */
function brandLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function brandTheme(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : UNBRANDED.theme;
}

/**
 * Unlike the fields below it, nothing here throws. The language list is load
 * bearing — without it there is no app — but the brand is decoration over a
 * working one, so every malformed value falls back and the attendee still
 * gets a working page.
 */
export function parseBrand(payload: unknown): Brand {
  if (typeof payload !== "object" || payload === null) return UNBRANDED;
  const raw = payload as Record<string, unknown>;

  const accent = typeof raw.accent === "string" ? raw.accent : "";

  return {
    name: brandName(raw.name),
    accent: parseHex(accent) ? accent : UNBRANDED.accent,
    logoUrl: brandLogoUrl(raw.logoUrl),
    theme: brandTheme(raw.theme),
  };
}

/**
 * The scheme actually being painted.
 *
 * The reader's own choice wins outright when they have made one: the operator
 * picks what suits the room, but only the person holding the phone knows
 * whether they are in the dim hall or the bright foyer outside it.
 */
export function resolveScheme(
  theme: Theme,
  prefersDark: boolean,
  reader: "light" | "dark" | null = null,
): "dark" | "light" {
  if (reader) return reader;
  if (theme === "auto") return prefersDark ? "dark" : "light";
  return theme;
}

export interface WebConfig {
  offeredLanguages: string[];
  /**
   * The code of the untranslated passthrough lane, when the operator has
   * turned that debug lane on; null otherwise. There is no source language:
   * every offered language is a translation, and the model detects what is
   * being spoken.
   */
  passthroughLanguage: string | null;
  /** Fixed delay applied before rendering a transcript line, so text does not
   *  run ahead of the audio by the <audio> buffer depth. */
  transcriptDelayMs: number;
  /**
   * Whether the operator has started capture. False until the ingest socket
   * opens, so an early arrival is told to wait rather than handed silence —
   * and cannot open a Gemini session against an empty room.
   */
  live: boolean;
  /**
   * How much recent audio the server writes ahead of live clusters on every
   * new stream. A plain `<audio src>` starts at the oldest byte it receives,
   * so this is also how far behind the room that fallback path sits — the
   * number its drift threshold must be sized from. 0 when the server did not
   * say (an older build), which leaves the threshold at its floor.
   */
  streamPrimeMs: number;
  brand: Brand;
}

/** A millisecond field that may be absent (read as 0) but never negative or non-numeric. */
function nonNegativeMs(raw: unknown, name: string): number {
  const ms = raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`/config ${name} must be a non-negative number`);
  }
  return ms;
}

export function parseConfig(payload: unknown): WebConfig {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("/config is not an object");
  }
  const raw = payload as Record<string, unknown>;

  const offered = raw.offeredLanguages;
  if (
    !Array.isArray(offered) ||
    offered.length === 0 ||
    !offered.every((l) => typeof l === "string" && l.length > 0)
  ) {
    throw new Error("/config offeredLanguages must be a non-empty array of language codes");
  }

  const passthrough = raw.passthroughLanguage;

  return {
    offeredLanguages: offered as string[],
    passthroughLanguage:
      typeof passthrough === "string" && passthrough.length > 0 ? passthrough : null,
    transcriptDelayMs: nonNegativeMs(raw.transcriptDelayMs, "transcriptDelayMs"),
    streamPrimeMs: nonNegativeMs(raw.streamPrimeMs, "streamPrimeMs"),
    // Anything but a literal true is "not live". A malformed flag read as live
    // would let a reader open a billed session against an empty room; read as
    // not-live it only makes them wait for the next poll.
    live: raw.live === true,
    brand: parseBrand(raw.brand),
  };
}

export async function fetchConfig(
  httpBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WebConfig> {
  const response = await fetchImpl(`${httpBaseUrl}/config`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`/config responded ${response.status}`);
  }
  return parseConfig(await response.json());
}

/**
 * The page is served by the same process that serves audio and transcripts, so
 * both origins come from the page location. There is no configured host to get
 * wrong at the venue. Under the Vite dev server (a different port than the
 * server's 8080), `vite.config.ts` proxies `/config`, `/stream` and `/listen`
 * back to the server, so deriving from `window.location` still resolves to the
 * dev server's own origin and works unmodified.
 */
export function serverBaseUrls(location: { protocol: string; host: string }): {
  http: string;
  ws: string;
} {
  const secure = location.protocol === "https:";
  return {
    http: `${location.protocol}//${location.host}`,
    ws: `${secure ? "wss:" : "ws:"}//${location.host}`,
  };
}
