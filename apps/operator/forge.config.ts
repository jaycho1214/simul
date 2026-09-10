import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

// This workspace's pnpm nodeLinker is "hoisted" — but, verified by actually
// running `pnpm package` and inspecting the output, hoisted-for-a-workspace
// means ONE flat node_modules at the repo root; apps/operator/node_modules
// holds only .bin shims and Vite's own cache, never a real copy of anything
// it depends on, hoisted or direct. Electron Packager's ordinary copy step
// only ever sees apps/operator's own directory, so without this the packaged
// app ships with no node_modules at all and the utility process dies on
// require("opusscript") — the exact failure this file's asar-unpack comment
// below anticipates, but from a cause the "check node-linker=hoisted" advice
// doesn't cover: hoisting was correctly in effect and still insufficient.
// opusscript has no dependencies of its own (checked its package.json), so a
// plain recursive copy of the one directory is enough — no resolution graph
// to walk.
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

const config: ForgeConfig = {
  packagerConfig: {
    // opusscript's build/opusscript_native_wasm.js does
    // fs.readFileSync(__dirname + "/opusscript_native_wasm.wasm"). Electron's
    // asar fs shim can serve that read from inside the archive, but unpacking
    // removes the question entirely — and it is a 310 KB data file, not code,
    // so there is no size argument for keeping it packed.
    asar: { unpack: "**/opusscript/build/*.wasm" },
    name: "tongyeok",
    executableName: "tongyeok",
    appBundleId: "kr.tongyeok.operator",
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        cp(
          path.join(workspaceRoot, "node_modules", "opusscript"),
          path.join(buildPath, "node_modules", "opusscript"),
          { recursive: true },
        ).then(
          () => callback(),
          (err: Error) => callback(err),
        );
      },
    ],
    // apps/server's Task 16 static route serves the attendee SPA from
    // config.webRoot, which defaults to a path built from import.meta.url —
    // valid only as an ES module. Forge's Vite plugin bundles server-entry.js
    // (like main.js) to CommonJS, where that expression resolves against the
    // literal string "undefined" and throws. main.ts works around this by
    // always passing an explicit WEB_ROOT when it forks the server, computed
    // from process.resourcesPath once packaged — which only resolves to
    // something real because the build is copied here. extraResource copies
    // by basename, so this lands at Resources/dist (process.resourcesPath +
    // "/dist"), matching utils/path.ts's resolveWebRoot().
    extraResource: [fileURLToPath(new URL("../web/dist", import.meta.url))],
    extendInfo: {
      // Required before systemPreferences.askForMediaAccess("microphone") can
      // show a dialog on macOS; without it the app is killed on first call.
      NSMicrophoneUsageDescription:
        "통역 시스템이 믹서의 오디오를 캡처하려면 마이크 접근 권한이 필요합니다.",
    },
  },

  // No rebuildConfig. opusscript is pure JavaScript; @electron/rebuild has
  // nothing to compile and adding it back only introduces a step that can fail.

  makers: [
    // Windows: the venue laptop's installer.
    new MakerSquirrel({ name: "tongyeok", setupExe: "tongyeok-setup.exe" }),
    // macOS: a zip is enough for a development machine; there is no notarised
    // distribution channel and none is needed.
    new MakerZIP({}, ["darwin"]),
  ],

  plugins: [
    new VitePlugin({
      build: [
        { config: "vite.main.config.mts", entry: "src/main.ts", target: "main" },
        { config: "vite.preload.config.mts", entry: "src/preload.ts", target: "preload" },
        {
          config: "vite.server.config.mts",
          entry: "src/server-host/server-entry.ts",
          target: "main",
        },
      ],
      renderer: [{ config: "vite.renderer.config.mts", name: "main_window" }],
    }),
    // Unchanged from the template. RunAsNode stays false: utilityProcess does
    // not need ELECTRON_RUN_AS_NODE (see Task 7), so nothing here is a problem.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
