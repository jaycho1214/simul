/** biome-ignore-all lint/style/noNestedTernary: Dynamic get path for ES modules or CommonJS */
/** biome-ignore-all lint/correctness/noGlobalDirnameFilename: Dynamic get path for ES modules or CommonJS */
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getBasePath() {
  return typeof import.meta !== "undefined" && import.meta.url
    ? path.dirname(fileURLToPath(import.meta.url))
    : typeof __dirname === "undefined"
      ? process.cwd()
      : __dirname;
}

/**
 * Where the built attendee SPA (apps/web/dist) lives, so it can be passed to
 * the forked server as WEB_ROOT. apps/server's own default for this —
 * `fileURLToPath(new URL("../../web/dist", import.meta.url))` in config.ts —
 * assumes it is still running as an ES module. Forge's Vite plugin bundles
 * both main.js and server-entry.js to CommonJS, where that expression
 * resolves against the literal string "undefined" and *throws* ("Invalid
 * URL") rather than picking a wrong path — so `loadConfig` never even
 * returns unless something upstream supplies WEB_ROOT explicitly. Passing it
 * always, computed here, means that broken default path is never reached.
 *
 * Takes its inputs as plain values (not `app`/`electron`) so this stays a
 * pure function callers can unit-test without loading Electron — matching
 * `electronForkFn`'s lazy `require("electron")` a few files over.
 */
export function resolveWebRoot(basePath: string, packaged: boolean, resourcesPath: string): string {
  // Packaged: forge.config.ts's `extraResource` copies apps/web/dist into the
  // resources directory by basename, landing at <resourcesPath>/dist — this
  // is true on both platforms and independent of whether main.js itself sits
  // inside app.asar.
  if (packaged) return path.join(resourcesPath, "dist");
  // Dev (electron-forge start, unpackaged): basePath is `.vite/build`
  // (main.js's own directory, via getBasePath()), three levels below
  // apps/operator — go up to apps/, then into web/dist.
  return path.join(basePath, "..", "..", "..", "web", "dist");
}
