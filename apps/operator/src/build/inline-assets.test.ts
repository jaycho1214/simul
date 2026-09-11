import { describe, expect, test } from "vitest";
import { inlineAsset } from "./inline-assets.ts";

// The packaged renderer is a file:// document with `script-src 'self'`. A
// worklet module Vite has inlined as a data: URL is a script from nowhere,
// and Chromium refuses it: "Unable to load a worklet's module" — what the
// venue laptop showed on 2026-09-11 for every 시작. Emitted as a file next to
// the bundle it is same-origin and loads.
describe("inlineAsset", () => {
  test("never inlines an AudioWorklet module", () => {
    expect(inlineAsset("/repo/apps/operator/src/capture/pcm-tap.worklet.js")).toBe(false);
    expect(inlineAsset("src\\capture\\pcm-tap.worklet.js")).toBe(false);
  });

  test("leaves every other asset to Vite's size threshold", () => {
    expect(inlineAsset("/repo/src/assets/logo.svg")).toBeUndefined();
    expect(inlineAsset("/repo/src/capture/pcm.ts")).toBeUndefined();
  });
});
