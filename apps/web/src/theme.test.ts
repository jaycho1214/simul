import { beforeEach, describe, expect, test, vi } from "vitest";
import { PREFERENCE_KEY, nextPreference, readPreference, writePreference } from "./theme.ts";
import { resolveScheme } from "./config.ts";

/**
 * A real in-memory Storage. The runtime's own localStorage is not a complete
 * Storage here, and these tests are about this module's guarded access to one
 * — not about the browser's implementation of it.
 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } satisfies Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("the reader's theme preference", () => {
  test("is unset until the reader chooses", () => {
    expect(readPreference()).toBeNull();
  });

  test("round-trips a choice", () => {
    writePreference("light");
    expect(readPreference()).toBe("light");
  });

  test("clears back to the operator's setting", () => {
    writePreference("dark");
    writePreference(null);
    expect(readPreference()).toBeNull();
  });

  test("ignores a stored value it does not recognise", () => {
    localStorage.setItem(PREFERENCE_KEY, "sepia");
    expect(readPreference()).toBeNull();
  });

  /**
   * A phone in a dim hall can be in a private window, have site data blocked,
   * or be out of quota. None of those are a reason for the page not to render,
   * so every access is guarded and a failure just means "no preference".
   */
  test("survives storage that throws", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      clear: boom,
      key: boom,
      length: 0,
    });

    expect(readPreference()).toBeNull();
    expect(() => writePreference("dark")).not.toThrow();
  });
});

describe("nextPreference", () => {
  // Three states in one control: follow the operator, force light, force dark.
  test("cycles system to light to dark and back", () => {
    expect(nextPreference(null)).toBe("light");
    expect(nextPreference("light")).toBe("dark");
    expect(nextPreference("dark")).toBeNull();
  });
});

describe("the reader's choice beats the operator's", () => {
  test("overrides a configured theme", () => {
    expect(resolveScheme("dark", false, "light")).toBe("light");
  });

  test("falls back to the configured theme when unset", () => {
    expect(resolveScheme("light", true, null)).toBe("light");
  });

  test("still follows the device when the operator configured auto", () => {
    expect(resolveScheme("auto", true, null)).toBe("dark");
  });
});
