import { useState } from "react";
import type { Brand } from "../config.ts";
import { S } from "../strings.ts";
import type { AudioStatus } from "../audio/audio-stream-controller.ts";
import type { TranscriptState } from "../transcript/transcript-store.ts";
import { Bilingual } from "./Bilingual.tsx";
import { BrandBar } from "./BrandBar.tsx";
import { MuteButton } from "./MuteButton.tsx";
import { SilentSwitchNotice } from "./SilentSwitchNotice.tsx";
import { StatusBand, TallyLamp, bannerText } from "./StatusBanner.tsx";
import { TranscriptList } from "./TranscriptList.tsx";

export interface ListenScreenProps {
  brand: Brand;
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

  // Folding is only offered once audio has provably played; until then the
  // notice is not dismissible and this flag cannot open a way out.
  const foldable = props.audioStatus === "playing";
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const noticeOpen = !foldable || pinnedOpen;

  return (
    <main className="listen">
      <BrandBar brand={props.brand}>
        {/*
          Two parts, deliberately: a readout of the lane you are on with its
          tally lamp, and a button out of it.

          These were one control at first — tapping the language name went
          back — with the label hidden and only a caret to hint at it. Nobody
          found it. A reader who cannot read either of the app's two languages
          has only shape to go on, so the way back has to *look* like a button
          rather than rely on a chevron: it is the one bordered, tappable
          object in the bar, per the same rule the rest of the app follows.
        */}
        <div className="channel">
          <TallyLamp tone={banner.tone} />
          <span className="channel-lang" lang={props.lang}>
            {props.endonym}
          </span>
        </div>
        <button
          type="button"
          className="channel-change"
          aria-label={S.changeLanguage}
          onClick={props.onBack}
        >
          {S.changeShort}
        </button>
      </BrandBar>

      <div className="listen-body">
        <SilentSwitchNotice
          open={noticeOpen}
          foldable={foldable}
          onToggle={() => setPinnedOpen(!pinnedOpen)}
        />

        <StatusBand
          banner={banner}
          onRetry={props.transcript.error ? props.onRetry : undefined}
        />

        <TranscriptList
          lines={props.transcript.lines}
          interim={props.transcript.interim}
          emptyLabel={<Bilingual text={S.waitingForSpeech} />}
        />

        <MuteButton muted={props.muted} onToggle={props.onToggleMute} />
      </div>
    </main>
  );
}
