import type { CaptureError, CaptureSnapshot } from "./capture-controller.ts";
import type { DeviceReport } from "./device-report.ts";
import type { ConnectionState } from "../net/reconnecting-socket.ts";

/** What changed between two capture snapshots that is worth a log line or a toast. */
export type CaptureEvent =
  | { type: "started"; report: DeviceReport | undefined }
  | { type: "stopped" }
  | { type: "error"; error: CaptureError }
  | { type: "ingest"; state: ConnectionState; from: ConnectionState };

/**
 * The snapshot moves on every audio frame (sentFrames), so the log cannot
 * simply record each one. This picks out the transitions: start, stop, a new
 * error, and the ingest socket changing state while capture is running.
 * Pure, so the mapping from "what happened" to "what is said" is testable
 * without an AudioContext.
 */
export function captureEvents(prev: CaptureSnapshot, next: CaptureSnapshot): CaptureEvent[] {
  const events: CaptureEvent[] = [];

  if (!prev.running && next.running) events.push({ type: "started", report: next.report });
  if (prev.running && !next.running) events.push({ type: "stopped" });

  if (next.error && next.error !== prev.error) events.push({ type: "error", error: next.error });

  // A socket transition is only news while capture is up: stop() sets
  // "stopped" itself, and that is already the stop event above.
  if (prev.running && next.running && next.ingestState !== prev.ingestState) {
    events.push({ type: "ingest", state: next.ingestState, from: prev.ingestState });
  }

  return events;
}
