import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a UUID in either case", () => {
    expect(isUuid("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(isUuid("ABCDEF01-2345-4678-9ABC-DEF012345678")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "not-a-uuid", "11111111-2222-4333-8444-55555555555", " 11111111-2222-4333-8444-555555555555", null, undefined, 42]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
