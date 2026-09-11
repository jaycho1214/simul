import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveWebRoot } from "./path.ts";

describe("resolveWebRoot", () => {
  test("packaged: resources dir joined with the extraResource's basename", () => {
    expect(resolveWebRoot("/unused", true, "/Applications/Simul.app/Contents/Resources")).toBe(
      path.join("/Applications/Simul.app/Contents/Resources", "dist"),
    );
  });

  test("dev: three levels above main.js's own .vite/build directory, into apps/web/dist", () => {
    const basePath = "/repo/apps/operator/.vite/build";
    expect(resolveWebRoot(basePath, false, "/unused")).toBe(
      path.join("/repo", "apps", "web", "dist"),
    );
  });
});
