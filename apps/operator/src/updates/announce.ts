import type { UpdateState } from "./update-state.ts";

/**
 * Whether the toast should be shown, given what was last announced. Once per
 * staged version: a dismissed toast stays dismissed through every 5-second
 * poll, but a newer version staged later gets its own.
 */
export function nextAnnouncement(state: UpdateState, announced: string | null): string | null {
  if (state.status !== "ready" || !state.version) return null;
  return state.version === announced ? null : state.version;
}
