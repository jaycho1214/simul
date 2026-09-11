import { muteLabels } from "../languages.ts";
import { SpeakerIcon, SpeakerOffIcon } from "./icons.tsx";

export interface MuteButtonProps {
  /** The lane being listened to; the label is set in that language. */
  lang: string;
  muted: boolean;
  onToggle: () => void;
}

export function MuteButton({ lang, muted, onToggle }: MuteButtonProps) {
  const labels = muteLabels(lang);
  return (
    <button type="button" className="mute" aria-pressed={muted} onClick={onToggle}>
      {muted ? <SpeakerOffIcon className="mute-icon" /> : <SpeakerIcon className="mute-icon" />}
      {muted ? labels.unmute : labels.mute}
    </button>
  );
}
