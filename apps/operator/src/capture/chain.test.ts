import { describe, expect, test } from "vitest";
import { floatTo16BitPcm } from "./pcm.ts";
import { FrameAccumulator, INGEST_FRAME_BYTES } from "./frame-accumulator.ts";
import { measureLevel } from "./level.ts";

/** A 100 Hz → 4 kHz sweep at 16 kHz, the rate the AudioContext opens at. */
function sineSweep(samples: number, sampleRate = 16000): Float32Array {
  const out = new Float32Array(samples);
  const startHz = 100;
  const endHz = 4000;
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const hz = startHz + ((endHz - startHz) * i) / samples;
    phase += (2 * Math.PI * hz) / sampleRate;
    out[i] = 0.8 * Math.sin(phase);
  }
  return out;
}

/** The renderer feeds the chain one 128-sample AudioWorklet quantum at a time. */
function runChain(source: Float32Array): { frames: ArrayBuffer[]; pending: number } {
  const accumulator = new FrameAccumulator();
  const frames: ArrayBuffer[] = [];
  for (let i = 0; i < source.length; i += 128) {
    const quantum = source.subarray(i, Math.min(i + 128, source.length));
    frames.push(...accumulator.push(floatTo16BitPcm(quantum)));
  }
  return { frames, pending: accumulator.pendingSamples };
}

describe("offline capture chain", () => {
  const source = sineSweep(16000); // one second

  test("every emitted frame is exactly 640 bytes", () => {
    const { frames } = runChain(source);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.byteLength).toBe(INGEST_FRAME_BYTES);
  });

  test("one second at 16 kHz yields fifty 20 ms frames", () => {
    const { frames, pending } = runChain(source);
    expect(frames).toHaveLength(50);
    expect(pending).toBe(0);
  });

  test("the reassembled output matches the input within one quantisation step", () => {
    const { frames } = runChain(source);
    const out = new Int16Array(frames.length * 320);
    frames.forEach((frame, i) => out.set(new Int16Array(frame), i * 320));

    let worst = 0;
    for (let i = 0; i < out.length; i++) {
      worst = Math.max(worst, Math.abs(out[i]! / 32767 - source[i]!));
    }
    expect(worst).toBeLessThan(2 / 32767);
  });

  test("the sweep does not clip and reads as a sensible level", () => {
    const reading = measureLevel(source);
    expect(reading.clipping).toBe(false);
    expect(reading.peak).toBeCloseTo(0.8, 2);
    expect(reading.rmsDb).toBeGreaterThan(-12);
    expect(reading.rmsDb).toBeLessThan(-2);
  });

  test("no frame is silent, so no quantum was dropped mid-chain", () => {
    const { frames } = runChain(source);
    for (const frame of frames) {
      const samples = new Int16Array(frame);
      expect(samples.some((s) => s !== 0)).toBe(true);
    }
  });
});
