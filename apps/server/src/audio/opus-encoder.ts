import pkg from "@discordjs/opus";
import type { OpusEncoder as OpusEncoderType } from "@discordjs/opus";

// `@discordjs/opus` is CommonJS with a dynamically resolved `module.exports`
// (it re-exports a native-binding path picked at install time), so Node's
// ESM/CJS interop cannot statically detect `OpusEncoder` as a named export —
// `import { OpusEncoder } from "@discordjs/opus"` fails at runtime despite
// type-checking. Importing the default and destructuring sidesteps that gap.
const { OpusEncoder } = pkg;

/** 20 ms of mono 16-bit PCM at the given rate. */
export function frameBytesFor(sampleRate: number): number {
  return (sampleRate / 50) * 2;
}

export class LaneOpusEncoder {
  private readonly encoder: OpusEncoderType;
  private readonly frameBytes: number;
  private pending: Buffer = Buffer.alloc(0);

  constructor(
    readonly sampleRate: 16000 | 24000,
    bitrate: number,
  ) {
    this.encoder = new OpusEncoder(sampleRate, 1);
    this.encoder.setBitrate(bitrate);
    this.frameBytes = frameBytesFor(sampleRate);
  }

  get pendingBytes(): number {
    return this.pending.length;
  }

  encode(pcm: Buffer): Buffer[] {
    const buf = this.pending.length ? Buffer.concat([this.pending, pcm]) : pcm;
    const packets: Buffer[] = [];
    let offset = 0;

    while (offset + this.frameBytes <= buf.length) {
      packets.push(this.encoder.encode(buf.subarray(offset, offset + this.frameBytes)));
      offset += this.frameBytes;
    }

    this.pending = Buffer.from(buf.subarray(offset));
    return packets;
  }
}
