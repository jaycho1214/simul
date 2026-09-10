import { S } from "../strings.ts";

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
      {muted ? S.unmute : S.mute}
    </button>
  );
}
