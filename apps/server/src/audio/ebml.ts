/** Segment size meaning "unknown / streaming", per the Matroska spec. */
export const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/** EBML variable-size integer, used for element sizes. */
export function vintSize(value: number): Buffer {
  for (let len = 1; len <= 8; len++) {
    const max = 2 ** (7 * len) - 1;
    if (value < max) {
      const buf = Buffer.alloc(len);
      let v = value;
      for (let i = len - 1; i >= 0; i--) {
        buf[i] = v % 256;
        v = Math.floor(v / 256);
      }
      buf[0] = buf[0]! | (1 << (8 - len));
      return buf;
    }
  }
  throw new Error(`value too large for an EBML vint: ${value}`);
}

/** Big-endian unsigned integer with no leading zero bytes. */
export function uint(value: number): Buffer {
  if (value === 0) return Buffer.from([0x00]);
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return Buffer.from(bytes);
}

export function float64(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(value, 0);
  return buf;
}

/** Element ids are already length-encoded; emit their significant bytes. */
export function id(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return Buffer.from(bytes);
}

export function elem(idBytes: Buffer, payload: Buffer): Buffer {
  return Buffer.concat([idBytes, vintSize(payload.length), payload]);
}
