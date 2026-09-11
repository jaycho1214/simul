import { describe, expect, test } from "vitest";
import { FrameAccumulator, INGEST_FRAME_BYTES, INGEST_FRAME_SAMPLES } from "./frame-accumulator.ts";

const ramp = (n: number, start = 0) =>
  Int16Array.from({ length: n }, (_, i) => (start + i) % 30000);

describe("FrameAccumulator", () => {
  test("the frame size is the spec's 640 bytes of 16 kHz mono s16le", () => {
    expect(INGEST_FRAME_BYTES).toBe(640);
    expect(INGEST_FRAME_SAMPLES).toBe(320);
    expect(INGEST_FRAME_SAMPLES * 2).toBe(INGEST_FRAME_BYTES);
  });

  test("emits nothing until a whole frame has arrived", () => {
    const acc = new FrameAccumulator();
    expect(acc.push(ramp(319))).toEqual([]);
    expect(acc.pendingSamples).toBe(319);
  });

  test("emits exactly one frame at exactly 320 samples", () => {
    const acc = new FrameAccumulator();
    const frames = acc.push(ramp(320));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.byteLength).toBe(640);
    expect(acc.pendingSamples).toBe(0);
  });

  test("absorbs the 128-sample AudioWorklet render quantum", () => {
    // 128 does not divide 320, which is the whole reason this class exists.
    const acc = new FrameAccumulator();
    expect(acc.push(ramp(128, 0))).toEqual([]);
    expect(acc.push(ramp(128, 128))).toEqual([]);
    const third = acc.push(ramp(128, 256));
    expect(third).toHaveLength(1);
    expect(acc.pendingSamples).toBe(64);
  });

  test("emits several frames from one oversized push and keeps the remainder", () => {
    const acc = new FrameAccumulator();
    const frames = acc.push(ramp(320 * 3 + 40));
    expect(frames).toHaveLength(3);
    expect(acc.pendingSamples).toBe(40);
    for (const frame of frames) expect(frame.byteLength).toBe(640);
  });

  test("every emitted frame is exactly 640 bytes across a long uneven stream", () => {
    const acc = new FrameAccumulator();
    let emitted = 0;
    for (let i = 0; i < 500; i++) {
      for (const frame of acc.push(ramp(128, i * 128))) {
        expect(frame.byteLength).toBe(640);
        emitted++;
      }
    }
    // 500 * 128 = 64000 samples → floor(64000 / 320) = 200 frames.
    expect(emitted).toBe(200);
    expect(acc.pendingSamples).toBe(0);
  });

  test("frames reproduce the input stream in order with no gaps or repeats", () => {
    const acc = new FrameAccumulator();
    const source = ramp(320 * 4);
    const out: number[] = [];
    for (let i = 0; i < source.length; i += 128) {
      for (const frame of acc.push(source.subarray(i, i + 128))) {
        out.push(...new Int16Array(frame));
      }
    }
    expect(out).toEqual([...source]);
  });

  test("each frame owns its bytes and is not a view onto a reused buffer", () => {
    const acc = new FrameAccumulator();
    const [first] = acc.push(ramp(320, 1));
    const before = [...new Int16Array(first!)];
    acc.push(ramp(320, 9000));
    expect([...new Int16Array(first!)]).toEqual(before);
  });

  test("reset discards the partial frame", () => {
    const acc = new FrameAccumulator();
    acc.push(ramp(200));
    acc.reset();
    expect(acc.pendingSamples).toBe(0);
    expect(acc.push(ramp(319))).toEqual([]);
  });
});
