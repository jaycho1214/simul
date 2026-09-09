import { elem, id, uint, float64, UNKNOWN_SIZE } from "./ebml.ts";

export const CLUSTER_ID = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

const FRAME_MS = 20;

/**
 * OpusHead, 19 bytes. Note that WebM always declares Opus at 48 kHz because
 * Opus decodes to 48 kHz regardless of what went in; the true capture rate is
 * informational and lives only in this header.
 */
function opusHead(inputSampleRate: number): Buffer {
  const b = Buffer.alloc(19);
  b.write("OpusHead", 0, "ascii");
  b.writeUInt8(1, 8);                     // version
  b.writeUInt8(1, 9);                     // channel count
  b.writeUInt16LE(312, 10);               // pre-skip
  b.writeUInt32LE(inputSampleRate, 12);   // original input sample rate
  b.writeInt16LE(0, 16);                  // output gain
  b.writeUInt8(0, 18);                    // channel mapping family
  return b;
}

function buildInitSegment(inputSampleRate: number): Buffer {
  const ebmlHeader = elem(id(0x1a45dfa3), Buffer.concat([
    elem(id(0x4286), uint(1)),                    // EBMLVersion
    elem(id(0x42f7), uint(1)),                    // EBMLReadVersion
    elem(id(0x42f2), uint(4)),                    // EBMLMaxIDLength
    elem(id(0x42f3), uint(8)),                    // EBMLMaxSizeLength
    elem(id(0x4282), Buffer.from("webm")),        // DocType
    elem(id(0x4287), uint(4)),                    // DocTypeVersion
    elem(id(0x4285), uint(2)),                    // DocTypeReadVersion
  ]));

  const info = elem(id(0x1549a966), Buffer.concat([
    elem(id(0x2ad7b1), uint(1_000_000)),          // TimestampScale: 1 ms
    elem(id(0x4d80), Buffer.from("tongyeok")),    // MuxingApp
    elem(id(0x5741), Buffer.from("tongyeok")),    // WritingApp
  ]));

  const tracks = elem(id(0x1654ae6b), elem(id(0xae), Buffer.concat([
    elem(id(0xd7), uint(1)),                      // TrackNumber
    elem(id(0x73c5), uint(1)),                    // TrackUID
    elem(id(0x83), uint(2)),                      // TrackType: audio
    elem(id(0x86), Buffer.from("A_OPUS")),        // CodecID
    elem(id(0x63a2), opusHead(inputSampleRate)),  // CodecPrivate
    elem(id(0xe1), Buffer.concat([
      elem(id(0xb5), float64(48000)),             // SamplingFrequency
      elem(id(0x9f), uint(1)),                    // Channels
    ])),
  ])));

  // Segment is opened with an unknown size and never closed — it streams forever.
  const segmentOpen = Buffer.concat([id(0x18538067), UNKNOWN_SIZE]);
  return Buffer.concat([ebmlHeader, segmentOpen, info, tracks]);
}

function simpleBlock(relativeMs: number, opusFrame: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8(0x81, 0);          // track number 1 as an EBML vint
  header.writeInt16BE(relativeMs, 1);  // timestamp relative to the cluster
  header.writeUInt8(0x80, 3);          // flags: keyframe
  return elem(id(0xa3), Buffer.concat([header, opusFrame]));
}

export class WebMSink {
  readonly initSegment: Buffer;

  private readonly clusterMs: number;
  private readonly listeners = new Set<(cluster: Buffer) => void>();
  private blocks: Buffer[] = [];
  private clusterStartMs = 0;
  private elapsedMs = 0;

  constructor(opts: { inputSampleRate: number; clusterMs?: number }) {
    this.initSegment = buildInitSegment(opts.inputSampleRate);
    this.clusterMs = opts.clusterMs ?? 100;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  subscribe(fn: (cluster: Buffer) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  writeOpus(frame: Buffer): void {
    this.blocks.push(simpleBlock(this.elapsedMs - this.clusterStartMs, frame));
    this.elapsedMs += FRAME_MS;

    if (this.elapsedMs - this.clusterStartMs >= this.clusterMs) {
      this.flushCluster();
    }
  }

  private flushCluster(): void {
    if (this.blocks.length === 0) return;

    const cluster = elem(id(0x1f43b675), Buffer.concat([
      elem(id(0xe7), uint(this.clusterStartMs)),
      ...this.blocks,
    ]));

    this.blocks = [];
    this.clusterStartMs = this.elapsedMs;

    for (const fn of this.listeners) {
      try {
        fn(cluster);
      } catch (err) {
        console.error("cluster subscriber threw", err);
      }
    }
  }
}
