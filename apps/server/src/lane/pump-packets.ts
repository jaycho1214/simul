import { frameBytesFor, type LaneOpusEncoder } from "../audio/opus-encoder.ts";
import type { FrameBus } from "../frame-bus.ts";

/** One Opus packet's worth of audio; every lane timeline advances in these. */
export const FRAME_MS = 20;

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
    elapsedMs += FRAME_MS;
  }
  return elapsedMs;
}

/**
 * Fill a fresh lane's backlog with `primeMs` of encoded silence.
 *
 * Chrome's `<audio>` hands the demuxer network data only in whole 32 KiB
 * blocks, so a listener hears nothing until the first block is full. A cold
 * lane has no history to fill it with, and its first listener would otherwise
 * wait out that fill in real time.
 *
 * Silence only works for this because the encoder runs CBR: under VBR a 20 ms
 * frame of silence encodes to *three bytes*, so this whole prime would come to
 * under 2 KB and fill nothing. See `LaneOpusEncoder`, which sets
 * `OPUS_SET_VBR` to 0 for exactly this reason.
 *
 * Shared with `pumpPackets` for the same reason that function exists — both
 * lanes must advance their timeline identically or they drift apart.
 */
export function primeSilence(
  encoder: LaneOpusEncoder,
  frames: FrameBus,
  primeMs: number,
  elapsedMs: number,
): number {
  if (primeMs <= 0) return elapsedMs;
  const silence = Buffer.alloc(frameBytesFor(encoder.sampleRate));
  for (let ms = 0; ms < primeMs; ms += FRAME_MS) {
    elapsedMs = pumpPackets(encoder, frames, silence, elapsedMs);
  }
  return elapsedMs;
}
