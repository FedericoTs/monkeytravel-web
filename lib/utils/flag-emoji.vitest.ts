import { describe, expect, it } from "vitest";
import { flagEmoji } from "./flag-emoji";

describe("flagEmoji", () => {
  it("turns a two-letter country code into its flag, whatever the case", () => {
    expect(flagEmoji("PT")).toBe("🇵🇹");
    expect(flagEmoji("jp")).toBe("🇯🇵");
  });

  it("falls back to a globe for anything that is not a two-letter code", () => {
    for (const code of ["", null, undefined, "PRT", "P", "1A"]) expect(flagEmoji(code)).toBe("🌍");
  });
});
