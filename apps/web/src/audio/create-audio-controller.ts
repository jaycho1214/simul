import type { AudioController } from "./audio-controller.ts";
import { AudioStreamController, maxDriftSecFor } from "./audio-stream-controller.ts";
import { MseStreamController, mseSupported } from "./mse-stream-controller.ts";

export interface CreateAudioControllerOptions {
  element: HTMLAudioElement;
  httpBaseUrl: string;
  lang: string;
  /** The server's STREAM_PRIME_MS from /config; sizes the fallback's drift threshold. */
  streamPrimeMs: number;
  /** The lane's media clock, for the fallback's drift check. See AudioStreamController. */
  liveMediaSeconds: () => Promise<number | null>;
  /** The MediaSource constructor to probe. Injected by tests; the page's own otherwise. */
  mediaSource?: unknown;
}

/**
 * MediaSource where the browser can demux Opus/WebM through it, which puts a
 * listener about a second behind the room; the plain `<audio src>` path
 * everywhere else, which lands them behind by the server's prime (about 3 s
 * at the default bitrate) but needs nothing from the browser beyond playing a
 * URL. The choice is made once per tap, so the screen never has to know.
 */
export function createAudioController(opts: CreateAudioControllerOptions): AudioController {
  const ctor =
    "mediaSource" in opts
      ? opts.mediaSource
      : (globalThis as { MediaSource?: unknown }).MediaSource;
  if (mseSupported(ctor)) {
    return new MseStreamController({
      element: opts.element,
      httpBaseUrl: opts.httpBaseUrl,
      lang: opts.lang,
    });
  }
  return new AudioStreamController({
    element: opts.element,
    httpBaseUrl: opts.httpBaseUrl,
    lang: opts.lang,
    liveMediaSeconds: opts.liveMediaSeconds,
    maxDriftSec: maxDriftSecFor(opts.streamPrimeMs),
  });
}
