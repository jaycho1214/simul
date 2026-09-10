import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every unit test in this app runs against plain modules with no DOM and no
    // Electron. Anything that needs a real device, a real process or a real
    // canvas is on the manual checklist in the plan instead of being faked here.
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".vite/**", "out/**"],
  },
});
