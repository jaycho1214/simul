import { describe, expect, test } from "vitest";
import { AudioStreamController } from "./audio-stream-controller.ts";
import { createAudioController } from "./create-audio-controller.ts";
import { MseStreamController } from "./mse-stream-controller.ts";

function options(mediaSource: unknown) {
  return {
    element: document.createElement("audio"),
    httpBaseUrl: "http://192.168.1.4:8080",
    lang: "es",
    streamPrimeMs: 16_384,
    liveMediaSeconds: async () => null,
    mediaSource,
  };
}

describe("createAudioController", () => {
  test("takes the MediaSource path when the browser can demux Opus/WebM through it", () => {
    const supporting = Object.assign(function () {}, { isTypeSupported: () => true });
    expect(createAudioController(options(supporting))).toBeInstanceOf(MseStreamController);
  });

  test("falls back to the plain element without MediaSource at all", () => {
    expect(createAudioController(options(undefined))).toBeInstanceOf(AudioStreamController);
  });

  test("falls back when MediaSource exists but cannot take this stream type", () => {
    const refusing = Object.assign(function () {}, { isTypeSupported: () => false });
    expect(createAudioController(options(refusing))).toBeInstanceOf(AudioStreamController);
  });

  // The fallback rejoins when playback drifts further behind the lane clock
  // than the prime explains. With a 16 s prime a fixed 8 s threshold restarted
  // the stream every 5 s for every listener — the threshold has to follow the
  // prime the server actually sends.
  test("sizes the fallback's drift threshold from the server's prime", () => {
    const controller = createAudioController(options(undefined)) as AudioStreamController;
    expect(controller.maxDriftSeconds).toBeCloseTo(16.384 + 5, 3);
  });
});
