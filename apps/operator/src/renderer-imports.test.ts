import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = resolve(process.cwd(), "src");

/** Every renderer entry point: what Electron loads into the browser window. */
const RENDERER_ROOTS = ["components", "routes", "layouts", "hooks"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Value imports only. `import type { router } from "./router"` is erased by
 * the compiler and pulls nothing into the bundle — the renderer has always
 * taken its oRPC types straight from the main-process router that way, and
 * counting those would flag every panel in the app.
 */
function importsOf(file: string): { relative: string[]; builtins: string[] } {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/(^|\n)\s*(import|export)\s+([^;]*?)from\s+["']([^"']+)["']/g)]
    .filter(([, , , clause]) => !/^type\s/.test(clause!.trim()))
    .map((m) => m[4]!);
  return {
    relative: specifiers.filter((s) => s.startsWith(".")),
    builtins: specifiers.filter((s) => s.startsWith("node:")),
  };
}

function resolveSpecifier(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/**
 * A renderer module that reaches a Node builtin does not fail at build time —
 * Vite externalises `node:*` for the renderer target and emits a bundle
 * happily. It fails when Electron runs it, and because the failure happens
 * while the module graph is still evaluating, React never mounts and the whole
 * window is black.
 *
 * That is a blank operator app on a venue laptop with no error anyone can see,
 * so the import graph is checked here instead. The main process and the
 * preload bridge are exempt: Node is exactly what they are for.
 */
describe("renderer import graph", () => {
  test("no renderer module reaches a Node builtin", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();

    const visit = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);

      const { relative, builtins } = importsOf(file);
      if (builtins.length > 0) {
        const path = [...chain, file].map((f) => f.slice(SRC.length + 1)).join("\n    -> ");
        offenders.push(`${builtins.join(", ")} reached via:\n    ${path}`);
      }
      for (const specifier of relative) {
        const target = resolveSpecifier(file, specifier);
        if (target) visit(target, [...chain, file]);
      }
    };

    for (const root of RENDERER_ROOTS) {
      for (const entry of walk(join(SRC, root))) visit(entry, []);
    }

    expect(offenders.join("\n\n")).toBe("");
  });
});
