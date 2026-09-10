/**
 * Exactly 20 ms of 16 kHz mono s16le, the only frame size the server's
 * IngestGateway accepts. Kept here rather than imported from @tongyeok/protocol,
 * which exports types only.
 */
export const INGEST_FRAME_BYTES = 640;
export const INGEST_FRAME_SAMPLES = INGEST_FRAME_BYTES / 2;

/**
 * Turns an arbitrary stream of Int16 chunks into frames of exactly
 * INGEST_FRAME_BYTES. The AudioWorklet renders in 128-sample quanta and 128 does
 * not divide 320, so a partial frame is always outstanding; this class is the
 * only place that remainder is allowed to exist.
 */
export class FrameAccumulator {
  private readonly frameSamples: number;
  private readonly partial: Int16Array;
  private filled = 0;

  constructor(frameSamples: number = INGEST_FRAME_SAMPLES) {
    if (!Number.isInteger(frameSamples) || frameSamples <= 0) {
      throw new Error(`frameSamples must be a positive integer, got ${frameSamples}`);
    }
    this.frameSamples = frameSamples;
    this.partial = new Int16Array(frameSamples);
  }

  get pendingSamples(): number {
    return this.filled;
  }

  reset(): void {
    this.filled = 0;
  }

  /** Returns zero or more buffers, each exactly frameSamples * 2 bytes. */
  push(samples: Int16Array): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];
    let offset = 0;

    while (offset < samples.length) {
      const room = this.frameSamples - this.filled;
      const take = Math.min(room, samples.length - offset);
      this.partial.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === this.frameSamples) {
        // slice() copies, so the caller owns the bytes and we can refill
        // this.partial immediately without corrupting an in-flight frame.
        frames.push(this.partial.slice().buffer);
        this.filled = 0;
      }
    }

    return frames;
  }
}
