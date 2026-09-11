import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { inlineAsset } from "./src/build/inline-assets.ts";

export default defineConfig({
  build: {
    // The worklet must be a file, not a data: URL, or the packaged window's
    // CSP refuses it. See src/build/inline-assets.ts.
    assetsInlineLimit: inlineAsset,
  },
  plugins: [
    tanstackRouter({
      target: "react",
    }),
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
    preserveSymlinks: true,
  },
});
