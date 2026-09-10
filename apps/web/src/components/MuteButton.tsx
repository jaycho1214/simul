import { S } from "../strings.ts";
import { SpeakerIcon, SpeakerOffIcon } from "./icons.tsx";

export interface MuteButtonProps {
  muted: boolean;
  onToggle: () => void;
}

export function MuteButton({ muted, onToggle }: MuteButtonProps) {
  return (
    <button
      type="button"
      className="mute"
      aria-pressed={muted}
      onClick={onToggle}
    >
      {muted ? (
        <SpeakerOffIcon className="mute-icon" />
      ) : (
        <SpeakerIcon className="mute-icon" />
      )}
      {muted ? S.unmute : S.mute}
    </button>
  );
}
