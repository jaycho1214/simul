import { describe, expect, test } from "vitest";
import { MAX_LOGO_BYTES, logoDataUri, logoMimeType, storedLogoName, maskSecret } from "./brand.ts";

describe("maskSecret", () => {
  test("shows the last four characters so a key can be told apart", () => {
    expect(maskSecret("AIzaSyD-abcdefghijklmnop3f9a")).toBe("••••••••3f9a");
  });

  test("reveals nothing at all from a short value", () => {
    expect(maskSecret("abc")).toBe("••••••••");
  });

  test("has no mask for an unset key", () => {
    expect(maskSecret("")).toBeNull();
  });
});

describe("storedLogoName", () => {
  // The file is copied into the app's own storage under one fixed name, so
  // replacing a logo overwrites rather than accumulating a directory of dead
  // uploads across events.
  test.each([
    ["mark.SVG", "logo.svg"],
    ["Some Logo.png", "logo.png"],
    ["photo.jpeg", "logo.jpeg"],
  ])("stores %j as %j", (input, expected) => {
    expect(storedLogoName(input)).toBe(expected);
  });

  test.each(["mark.tiff", "logo", "script.svg.exe", "../../etc/passwd"])("refuses %j", (bad) => {
    expect(storedLogoName(bad)).toBeNull();
  });
});

describe("logoMimeType", () => {
  test("maps each servable extension", () => {
    expect(logoMimeType("logo.svg")).toBe("image/svg+xml");
    expect(logoMimeType("logo.PNG")).toBe("image/png");
    expect(logoMimeType("logo.jpg")).toBe("image/jpeg");
  });

  test("has no type for anything else", () => {
    expect(logoMimeType("logo.tiff")).toBeNull();
  });
});

describe("logoDataUri", () => {
  test("builds a data uri the renderer can put in an img src", () => {
    expect(logoDataUri("logo.png", "aGk=")).toBe("data:image/png;base64,aGk=");
  });

  test("has nothing for a type it cannot name", () => {
    expect(logoDataUri("logo.tiff", "aGk=")).toBeNull();
  });
});

describe("MAX_LOGO_BYTES", () => {
  // The file crosses an IPC bridge as base64 and is then held in a data URI in
  // the renderer, so the cap is about what a preview can carry, not what a
  // disk can hold.
  test("is a couple of megabytes, not unbounded", () => {
    expect(MAX_LOGO_BYTES).toBeGreaterThan(500_000);
    expect(MAX_LOGO_BYTES).toBeLessThanOrEqual(4_000_000);
  });
});
