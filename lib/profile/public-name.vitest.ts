import { describe, it, expect } from "vitest";
import { publicNameOrNull } from "./public-name";

/** A public byline is never the email's local part (for gmail that IS the address). */

describe("publicNameOrNull", () => {
  it("keeps a real name", () => {
    expect(publicNameOrNull("Ana Lopez", "ana.lopez1985@gmail.com")).toBe("Ana Lopez");
    expect(publicNameOrNull("  Ana  ", "a@x.com")).toBe("Ana");
  });

  it("drops the email's local part, whatever its case", () => {
    expect(publicNameOrNull("ana.lopez1985", "ana.lopez1985@gmail.com")).toBeNull();
    expect(publicNameOrNull("Ana.Lopez1985", "ana.lopez1985@gmail.com")).toBeNull();
  });

  it("drops anything that looks like an address, and empty names", () => {
    expect(publicNameOrNull("ana@gmail.com", "other@x.com")).toBeNull();
    expect(publicNameOrNull("   ", "a@x.com")).toBeNull();
    expect(publicNameOrNull(null, "a@x.com")).toBeNull();
    expect(publicNameOrNull(undefined, undefined)).toBeNull();
  });

  it("with no email to compare, a plain name passes", () => {
    expect(publicNameOrNull("Ana", null)).toBe("Ana");
  });
});
