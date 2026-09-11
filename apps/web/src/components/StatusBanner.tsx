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

/**
 * The tally lamp, read the way a broadcast one is: colour is the state and
 * nothing else. It lives inside the channel chip, so the reader's eye finds
 * "which language, and is it running" in one place.
 */
export function TallyLamp({ tone }: { tone: BannerTone }) {
  return <span className={`tally tally--${tone}`} aria-hidden="true" />;
}

export interface StatusBandProps {
  banner: Banner;
  onRetry?: (() => void) | undefined;
}

/**
 * Words, for when the lamp is not enough.
 *
 * A healthy session says so in one quiet green line — "실시간 / Live" — and
 * nothing else. Only warn and error earn a band with a sentence in it. The
 * lamp alone was tried first and the reader could not tell a session that
 * was live from one that had simply gone quiet, so the words stay; they are
 * kept to a single small line so the transcript loses as little height as
 * possible. The `role="status"` node stays mounted in every state so a
 * screen reader hears the transitions either way.
 */
export function StatusBand({ banner, onRetry }: StatusBandProps) {
  if (banner.tone === "ok") {
    return (
      <p className="status status--ok" role="status">
        {/* The ping: a steady dot sending a ring out once a second, so a
            reader glancing over can see the feed is running, not frozen. */}
        <span className="live-dot" aria-hidden="true" />
        <span className="status-text">{banner.text}</span>
      </p>
    );
  }

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
