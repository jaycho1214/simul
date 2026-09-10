import { S } from "../strings.ts";
import type { AudioStatus } from "../audio/audio-stream-controller.ts";
import type {
  TranscriptError,
  TranscriptState,
} from "../transcript/transcript-store.ts";

export type BannerTone = "ok" | "warn" | "error";

export interface Banner {
  text: string;
  tone: BannerTone;
}

export interface BannerInput {
  laneState: TranscriptState["laneState"];
  audioStatus: AudioStatus;
  error: TranscriptError | null;
}

/**
 * One line of truth for the reader, chosen by severity. Kept as a pure
 * function so every branch is testable without rendering.
 *
 * The lane now pushes genuine transitions (see ListenClient/transcript-store):
 * a routine ~10-minute session rotation goes `live -> reconnecting -> live`,
 * which is normal and must not read as alarming, while `error` is only
 * reached once the server's reconnection backoff has saturated — that is a
 * real, sustained failure the operator needs to act on. The two are told
 * apart purely by the server-reported `laneState`, not by any client-side
 * timer: `reconnecting` always maps to the "warn" tone (amber, no retry
 * offered — the client did nothing wrong and there is nothing to retry
 * locally), `error` always maps to "error" (red). ListenScreen additionally
 * only offers a retry action when the server sent an explicit `error`
 * message (lane_cap / unknown_language) — a case where re-attempting the
 * connection can plausibly help — never for a bare `laneState === "error"`,
 * where retrying from the client cannot fix an upstream failure and offering
 * a button would be a false promise.
 */
export function bannerText(input: BannerInput): Banner {
  if (input.error?.code === "lane_cap") return { text: S.laneCap, tone: "error" };
  if (input.error?.code === "unknown_language") {
    return { text: S.unknownLanguage, tone: "error" };
  }
  if (input.laneState === "error") return { text: S.laneError, tone: "error" };
  if (input.laneState === "reconnecting") {
    return { text: S.reconnecting, tone: "warn" };
  }
  if (input.audioStatus === "failed") return { text: S.tapToPlay, tone: "warn" };
  if (input.audioStatus === "stalled") {
    return { text: S.audioStalled, tone: "warn" };
  }
  if (input.laneState === "connecting") return { text: S.connecting, tone: "warn" };
  if (input.laneState === "starting") return { text: S.starting, tone: "warn" };
  return { text: S.live, tone: "ok" };
}

export interface StatusBannerProps {
  banner: Banner;
  onRetry?: (() => void) | undefined;
}

export function StatusBanner({ banner, onRetry }: StatusBannerProps) {
  return (
    <div className={`status status--${banner.tone}`} role="status">
      <span className="status-text">{banner.text}</span>
      {onRetry ? (
        <button type="button" className="status-retry" onClick={onRetry}>
          {S.retry}
        </button>
      ) : null}
    </div>
  );
}
