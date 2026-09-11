import OpusScript from "opusscript";

const OPUS_SET_BITRATE = 4002;
const OPUS_SET_VBR = 4006;

/** 20 ms of mono 16-bit PCM at the given rate. */
export function frameBytesFor(sampleRate: number): number {
  return (sampleRate / 50) * 2;
}

export class LaneOpusEncoder {
  private readonly encoder: OpusScript;
  private readonly frameBytes: number;
  private readonly frameSamples: number;
  private pending: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    readonly sampleRate: 16000 | 24000,
    bitrate: number,
  ) {
    this.encoder = new OpusScript(sampleRate, 1, OpusScript.Application.VOIP);
    this.encoder.encoderCTL(OPUS_SET_BITRATE, bitrate);
    // Constant bitrate, deliberately, even though VBR would be cheaper.
    //
    // Chrome's `<audio>` MultiBufferDataSource hands the demuxer network data
    // only in whole 32 KiB blocks, so how long a listener waits before hearing
    // anything is set by the WIRE BYTE RATE, not by the audio. Under VBR a
    // 20 ms frame of silence encodes to *three bytes*, so a quiet room slows
    // the byte rate to a crawl and the block — and the listener — waits that
    // much longer. Worse, it makes startup depend on whether anyone happens to
    // be talking, which is exactly the kind of timing that behaves in
    // rehearsal and fails during the pause before a speaker begins.
    this.encoder.encoderCTL(OPUS_SET_VBR, 0);
    this.frameBytes = frameBytesFor(sampleRate);
    this.frameSamples = sampleRate / 50;
  }

  get pendingBytes(): number {
    return this.pending.length;
  }

  encode(pcm: Buffer): Buffer[] {
    if (this.closed) {
      throw new Error("LaneOpusEncoder.encode() called after close()");
    }

    const buf = this.pending.length ? Buffer.concat([this.pending, pcm]) : pcm;
    const packets: Buffer[] = [];
    let offset = 0;

    while (offset + this.frameBytes <= buf.length) {
      packets.push(
        this.encoder.encode(buf.subarray(offset, offset + this.frameBytes), this.frameSamples),
      );
      offset += this.frameBytes;
    }

    this.pending = Buffer.from(buf.subarray(offset));
    return packets;
  }

  /**
   * opusscript allocates its encoder buffers on a module-level WASM heap via
   * `_malloc` and only frees them via this explicit call — there is no
   * FinalizationRegistry or GC hook backing it. Lanes open and close on
   * subscriber refcount throughout a long event, so callers MUST call this
   * when a lane's encoder is discarded, or its WASM allocation leaks for the
   * life of the process.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.encoder.delete();
  }
}
