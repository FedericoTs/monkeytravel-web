/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { advisoryCountry } from "./country";

describe("the country a destination's travel advice is asked for", () => {
  it.each([
    ["Bangkok, Thailand", "Thailand"],
    ["Cancun, Quintana Roo, Mexico", "Mexico"],
    ["Paris, France, ", "France"],
    ["Thailand", "Thailand"],
    ["  india ", "india"],
  ])("%s is %s", (destination, country) => {
    expect(advisoryCountry(destination)).toBe(country);
  });

  it("is nothing for a blank destination", () => {
    expect(advisoryCountry("")).toBe("");
    expect(advisoryCountry(" , ")).toBe("");
  });
});
