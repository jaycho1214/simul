import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  packagerConfig: {
    asar: true,
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          config: "vite.main.config.mts",
          entry: "src/main.ts",
          target: "main",
        },
        {
          config: "vite.preload.config.mts",
          entry: "src/preload.ts",
          target: "preload",
        },
        {
          // The translation server, bundled for the utility process. target
          // "main" because it runs in a Node context, not a renderer; the
          // output lands beside main.js in .vite/build as server-entry.js.
          config: "vite.server.config.mts",
          entry: "src/server-host/server-entry.ts",
          target: "main",
        },
      ],
      renderer: [
        {
          config: "vite.renderer.config.mts",
          name: "main_window",
        },
      ],
    }),

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
  rebuildConfig: {},
};

export default config;
