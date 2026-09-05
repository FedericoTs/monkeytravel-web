import { describe, expect, it } from "vitest";
import { tripLocale } from "./language";

describe("tripLocale", () => {
  it("returns the stamped language", () => {
    expect(tripLocale({ locale: "it" })).toBe("it");
    expect(tripLocale({ destination: "Lisbon", locale: "pt" })).toBe("pt");
  });

  it("returns null for trips without a stamp or with junk", () => {
    expect(tripLocale(null)).toBeNull();
    expect(tripLocale(undefined)).toBeNull();
    expect(tripLocale({})).toBeNull();
    expect(tripLocale({ locale: "" })).toBeNull();
    expect(tripLocale({ locale: "de" })).toBeNull();
    expect(tripLocale({ locale: 42 })).toBeNull();
    expect(tripLocale("it")).toBeNull();
  });

  it("does not normalise regional tags — the stamp is written normalised", () => {
    // resolveAiLanguage handles "pt-BR" at the cookie boundary; a stamp is
    // always one of the four base tags, so anything else is treated as absent.
    expect(tripLocale({ locale: "pt-BR" })).toBeNull();
  });
});
