export interface WebConfig {
  offeredLanguages: string[];
  sourceLanguage: string;
  /** Fixed delay applied before rendering a transcript line, so text does not
   *  run ahead of the audio by the <audio> buffer depth. */
  transcriptDelayMs: number;
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
    throw new Error(
      "/config offeredLanguages must be a non-empty array of language codes",
    );
  }

  const source = raw.sourceLanguage;
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("/config sourceLanguage must be a language code");
  }

  const rawDelay = raw.transcriptDelayMs;
  const transcriptDelayMs = rawDelay === undefined ? 0 : Number(rawDelay);
  if (!Number.isFinite(transcriptDelayMs) || transcriptDelayMs < 0) {
    throw new Error("/config transcriptDelayMs must be a non-negative number");
  }

  return {
    offeredLanguages: offered as string[],
    sourceLanguage: source,
    transcriptDelayMs,
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
export function serverBaseUrls(location: {
  protocol: string;
  host: string;
}): { http: string; ws: string } {
  const secure = location.protocol === "https:";
  return {
    http: `${location.protocol}//${location.host}`,
    ws: `${secure ? "wss:" : "ws:"}//${location.host}`,
  };
}
