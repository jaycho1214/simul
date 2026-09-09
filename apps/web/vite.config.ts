import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Venue phones are whatever walked in the door, including old ones.
    target: ["es2019", "safari13", "chrome80"],
    sourcemap: false,
  },
  server: {
    // `pnpm dev` runs Vite in front of a separately started server on 8080.
    proxy: {
      "/config": "http://127.0.0.1:8080",
      "/stream": "http://127.0.0.1:8080",
      "/listen": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
