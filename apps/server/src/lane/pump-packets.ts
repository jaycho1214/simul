import type { LaneOpusEncoder } from "../audio/opus-encoder.ts";
import type { FrameBus } from "../frame-bus.ts";

/**
 * Encode PCM and publish each resulting 20 ms Opus packet on `frames`,
 * advancing the running timestamp by 20 ms per packet.
 *
 * Shared by SourceLane and TranslatedLane so their frame timing can never
 * drift apart — the two lanes must stay in lockstep, and a change to this
 * logic made in only one of them would be a silent bug in the other.
 *
 * Returns the advanced elapsed-ms value; callers must store it back onto
 * their own running counter.
 */
export function pumpPackets(
  encoder: LaneOpusEncoder,
  frames: FrameBus,
  pcm: Buffer,
  elapsedMs: number,
): number {
  for (const packet of encoder.encode(pcm)) {
    frames.publish(packet, elapsedMs);
    elapsedMs += 20;
  }
  return elapsedMs;
}
