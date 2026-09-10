const LADDER = [500, 1000, 2000, 4000, 8000] as const;

/** Consecutive crashes back off from 0.5 s to an 8 s ceiling. */
export function restartDelayMs(consecutiveFailures: number): number {
  const index = Math.min(Math.max(0, Math.trunc(consecutiveFailures)), LADDER.length - 1);
  return LADDER[index]!;
}

export const GIVE_UP_AFTER = 5;
export const GIVE_UP_WINDOW_MS = 60_000;

/** Timestamps of previous crashes, oldest first. */
export type RestartFailure = number;

/**
 * A server that dies five times in a minute has a real problem — a missing API
 * key, a port already bound, a broken native module — and restarting it forever
 * only hides the message the engineer needs to read.
 */
export function shouldGiveUp(failures: readonly RestartFailure[], nowMs: number): boolean {
  const recent = failures.filter((at) => nowMs - at <= GIVE_UP_WINDOW_MS);
  return recent.length >= GIVE_UP_AFTER;
}
