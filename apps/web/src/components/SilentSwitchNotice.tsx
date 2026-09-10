import { S } from "../strings.ts";

/**
 * The iOS silent switch mutes <audio> just like it mutes any other app, and an
 * attendee who has it flipped hears nothing at all. They have no reason to
 * suspect their phone rather than the event's system, so this is the single
 * most likely way a working setup looks broken. Only HTTPS + WebRTC removes
 * this class of failure properly (see the standing contract's plain-HTTP
 * constraint), so until then the mitigation is that this notice is always on
 * screen, styled loudly (see .silent-notice in styles.css) and never
 * dismissible — there is deliberately no close button.
 */
export function SilentSwitchNotice() {
  return (
    <aside className="silent-notice" role="note">
      <strong className="silent-notice-title">{S.silentSwitchTitle}</strong>
      <span className="silent-notice-body">{S.silentSwitchBody}</span>
    </aside>
  );
}
