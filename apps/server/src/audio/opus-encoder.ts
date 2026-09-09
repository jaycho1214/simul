import OpusScript from "opusscript";

const OPUS_SET_BITRATE = 4002;

/** 20 ms of mono 16-bit PCM at the given rate. */
export function frameBytesFor(sampleRate: number): number {
  return (sampleRate / 50) * 2;
}

export class LaneOpusEncoder {
  private readonly encoder: OpusScript;
  private readonly frameBytes: number;
  private readonly frameSamples: number;
  private pending: Buffer = Buffer.alloc(0);

  constructor(
    readonly sampleRate: 16000 | 24000,
    bitrate: number,
  ) {
    this.encoder = new OpusScript(sampleRate, 1, OpusScript.Application.VOIP);
    this.encoder.encoderCTL(OPUS_SET_BITRATE, bitrate);
    this.frameBytes = frameBytesFor(sampleRate);
    this.frameSamples = sampleRate / 50;
  }

  get pendingBytes(): number {
    return this.pending.length;
  }

  encode(pcm: Buffer): Buffer[] {
    const buf = this.pending.length ? Buffer.concat([this.pending, pcm]) : pcm;
    const packets: Buffer[] = [];
    let offset = 0;

    while (offset + this.frameBytes <= buf.length) {
      packets.push(this.encoder.encode(buf.subarray(offset, offset + this.frameBytes), this.frameSamples));
      offset += this.frameBytes;
    }

    this.pending = Buffer.from(buf.subarray(offset));
    return packets;
  }
}
