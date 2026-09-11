/**
 * Vite's `build.assetsInlineLimit` as a rule rather than a byte count.
 *
 * The one asset that must never be inlined is the AudioWorklet module. The
 * renderer's index.html sets `script-src 'self'`, and the packaged window is
 * a file:// document, so a worklet handed to `addModule()` as a data: URL is
 * a script from no origin — Chromium blocks it and `addModule` rejects with
 * "Unable to load a worklet's module". As a file emitted beside the bundle it
 * is same-origin, and Electron serves it from inside the asar like any other
 * asset. `undefined` hands everything else back to Vite's default threshold.
 */
export function inlineAsset(filePath: string): boolean | undefined {
  return /\.worklet\.js$/.test(filePath) ? false : undefined;
}
