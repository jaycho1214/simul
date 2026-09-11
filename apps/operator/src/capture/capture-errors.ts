/**
 * Which piece of advice fits a getUserMedia rejection. The message Chromium
 * attaches is often the same for very different causes ("Could not start
 * audio source"); the DOMException name is what tells them apart, and each
 * name here is something the engineer can act on differently at a desk.
 */
export type CaptureErrorHint = "notAllowed" | "notReadable" | "notFound";

const HINTS: Record<string, CaptureErrorHint> = {
  // Windows Settings → Privacy → Microphone → "Let desktop apps access your
  // microphone" off, or macOS TCC denied. No amount of re-picking fixes it.
  NotAllowedError: "notAllowed",
  PermissionDeniedError: "notAllowed",
  // The endpoint exists but will not start: another program holds it
  // exclusively (an ASIO client on the X-AIR, a DAW), or the driver refused.
  NotReadableError: "notReadable",
  TrackStartError: "notReadable",
  AbortError: "notReadable",
  // The stored deviceId no longer names anything, or the device cannot meet
  // the request: the list changed, so pick it again.
  NotFoundError: "notFound",
  DevicesNotFoundError: "notFound",
  OverconstrainedError: "notFound",
};

export function captureErrorHint(name: string): CaptureErrorHint | undefined {
  return HINTS[name];
}

/**
 * The name and message of whatever getUserMedia (or the graph) threw, kept
 * apart. An OverconstrainedError has no message; its `constraint` names the
 * request the device could not meet (almost always `deviceId`, a stored id
 * the machine no longer has), and that is what goes in its place.
 */
export function describeCaptureCause(err: unknown): { name: string; reason: string } {
  if (err instanceof Error) {
    const constraint = (err as { constraint?: unknown }).constraint;
    const reason =
      err.message ||
      (typeof constraint === "string" && constraint ? `constraint ${constraint}` : "(no message)");
    return { name: err.name, reason };
  }
  return { name: "", reason: String(err) };
}
