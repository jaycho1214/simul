import { describe, expect, test } from "vitest";
import { parsePort } from "./port.ts";

describe("parsePort", () => {
  test("accepts a whole number in the bindable range", () => {
    expect(parsePort("8080")).toBe(8080);
    expect(parsePort(" 1 ")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
  });

  test.each(["", "0", "65536", "-1", "80a", "8080.5", "eighty", "0x1f90"])(
    "refuses %j rather than letting the store reset it to the default",
    (text) => {
      expect(parsePort(text)).toBeNull();
    },
  );
});
