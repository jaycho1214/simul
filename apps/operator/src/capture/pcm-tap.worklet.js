/**
 * Copies each render quantum of the selected channel to the renderer's main
 * thread. Deliberately does no arithmetic: conversion and framing live in
 * ../capture/pcm.ts and ../capture/frame-accumulator.ts, which have real tests.
 *
 * Plain JavaScript with no imports, because AudioWorklet module scripts are
 * fetched at runtime and any bare-specifier import would fail under file://.
 * Excluded from tsconfig; there is nothing here to type.
 */
class PcmTapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // A disconnected or not-yet-running input yields an empty array. Keep the
    // processor alive: returning false would permanently remove it from the graph.
    if (!channel || channel.length === 0) return true;

    // The input buffer is reused by the audio thread, so it must be copied
    // before it is transferred.
    const copy = new Float32Array(channel);
    this.port.postMessage(copy, [copy.buffer]);
    return true;
  }
}

registerProcessor("pcm-tap", PcmTapProcessor);
