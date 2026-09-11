import { S, bilingual } from "../strings.ts";
import { SilentSwitchIcon } from "./icons.tsx";

export interface SilentSwitchNoticeProps {
  open: boolean;
  /**
   * Whether the reader is allowed to fold it away. False until the audio
   * element has actually played, which is the only evidence we get that the
   * person this notice exists for is not the one reading it.
   */
  foldable: boolean;
  onToggle: () => void;
}

/**
 * The iOS silent switch mutes <audio> just like it mutes any other app, and an
 * attendee who has it flipped hears nothing at all. They have no reason to
 * suspect their phone rather than the event's system, so this is the single
 * most likely way a working setup looks broken. Only HTTPS + WebRTC removes
 * this class of failure properly (see the standing contract's plain-HTTP
 * constraint), so until then this notice is the mitigation.
 *
 * It opens loud and, while audio has not been heard, cannot be dismissed —
 * there is deliberately no close button in that state, because the reader who
 * needs it is exactly the reader who cannot tell that it worked. Once the
 * element reports it is playing, the notice folds to a single quiet line so
 * the transcript gets the rest of the service, and any stall or failure
 * re-opens it. The pictogram is for the reader who can follow neither of the
 * two languages it is written in.
 */
export function SilentSwitchNotice(props: SilentSwitchNoticeProps) {
  if (!props.open) {
    return (
      <button
        type="button"
        className="silent-folded"
        aria-expanded={false}
        onClick={props.onToggle}
      >
        <SilentSwitchIcon className="silent-folded-icon" />
        <span className="silent-folded-text">{S.silentSwitchTitle}</span>
      </button>
    );
  }

  const body = bilingual(S.silentSwitchBody);
  const inner = (
    <>
      <SilentSwitchIcon className="silent-notice-icon" />
      <strong className="silent-notice-title">{S.silentSwitchTitle}</strong>
      <span className="silent-notice-body">
        {body.ko}
        <span className="silent-notice-en">{body.en}</span>
      </span>
    </>
  );

  // Interactive only once folding is allowed: while audio has not played this
  // is a notice, not a control, and must not offer a way out.
  if (!props.foldable) {
    return (
      <aside className="silent-notice" role="note">
        {inner}
      </aside>
    );
  }

  return (
    <button
      type="button"
      className="silent-notice"
      aria-expanded={true}
      onClick={props.onToggle}
    >
      {inner}
    </button>
  );
}
