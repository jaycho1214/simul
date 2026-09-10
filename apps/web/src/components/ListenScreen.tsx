import { S } from "../strings.ts";
import type { AudioStatus } from "../audio/audio-stream-controller.ts";
import type { TranscriptState } from "../transcript/transcript-store.ts";
import { MuteButton } from "./MuteButton.tsx";
import { SilentSwitchNotice } from "./SilentSwitchNotice.tsx";
import { StatusBanner, bannerText } from "./StatusBanner.tsx";
import { TranscriptList } from "./TranscriptList.tsx";

export interface ListenScreenProps {
  lang: string;
  endonym: string;
  muted: boolean;
  audioStatus: AudioStatus;
  transcript: TranscriptState;
  onToggleMute: () => void;
  onBack: () => void;
  onRetry: () => void;
}

/**
 * One mode only: audio and transcript together. There is deliberately no
 * transcript-only or audio-only choice to make.
 *
 * Retry is only wired up when the server sent an explicit `error` message
 * (transcript.error is set) — see StatusBanner/bannerText for why a bare
 * laneState of "error" does not get a retry button.
 */
export function ListenScreen(props: ListenScreenProps) {
  const banner = bannerText({
    laneState: props.transcript.laneState,
    audioStatus: props.audioStatus,
    error: props.transcript.error,
  });

  return (
    <main className="listen">
      <header className="listen-header">
        <span className="listen-lang" lang={props.lang}>
          {props.endonym}
        </span>
        <button type="button" className="listen-back" onClick={props.onBack}>
          {S.changeLanguage}
        </button>
      </header>

      <SilentSwitchNotice />

      <StatusBanner
        banner={banner}
        onRetry={props.transcript.error ? props.onRetry : undefined}
      />

      <TranscriptList
        lines={props.transcript.lines}
        interim={props.transcript.interim}
        emptyLabel={S.waitingForSpeech}
      />

      <MuteButton muted={props.muted} onToggle={props.onToggleMute} />
    </main>
  );
}
