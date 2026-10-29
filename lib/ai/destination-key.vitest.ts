import { describe, expect, it } from "vitest";
import { countryCode, destinationKey, foldText } from "./destination-key";

describe("countryCode", () => {
  it.each([
    ["Japan", "JP"],
    ["Giappone", "JP"],
    ["Japón", "JP"],
    ["Japão", "JP"],
    ["United States", "US"],
    ["USA", "US"],
    ["Estados Unidos", "US"],
    ["United Kingdom", "GB"],
    ["Regno Unito", "GB"],
    ["England", "GB"],
    ["Czech Republic", "CZ"],
    ["Czechia", "CZ"],
    ["Türkiye", "TR"],
    ["Turkey", "TR"],
    ["Nuova Zelanda", "NZ"],
    ["Brasil", "BR"],
    ["Germany", "DE"],
    ["Vietnam", "VN"],
    ["Myanmar (Burma)", "MM"],
  ])("%s is %s", (name, code) => {
    expect(countryCode(name)).toBe(code);
  });

  it.each(["Texas", "Marrakesh", "Rome", "TN", "", null])("%s is no country", (name) => {
    expect(countryCode(name)).toBeNull();
  });
});

describe("destinationKey", () => {
  it("is one place however its country is written, or left out", () => {
    const tokyo = { city: "tokyo", country: "JP" };
    expect(destinationKey("Tokyo, Japan")).toEqual(tokyo);
    expect(destinationKey("tokyo,  Japan ")).toEqual(tokyo);
    expect(destinationKey("Tokyo", "Japan")).toEqual(tokyo);
    expect(destinationKey("Tokyo")).toEqual({ city: "tokyo", country: null });
  });

  it("keeps a part that is not a country", () => {
    expect(destinationKey("Paris, Texas")).toEqual({ city: "paris, texas", country: null });
    expect(destinationKey("Lisbon, Marrakesh", "Portugal")).toEqual({ city: "lisbon, marrakesh", country: "PT" });
    expect(destinationKey("Portland, Maine, United States")).toEqual({ city: "portland, maine", country: "US" });
  });

  it("tells same-named cities apart by their country", () => {
    expect(destinationKey("Valencia, Venezuela")).not.toEqual(destinationKey("Valencia, Spain"));
    expect(destinationKey("Manchester, United States").country).toBe("US");
  });

  it("ignores accents and punctuation", () => {
    expect(destinationKey("Hà Nội, Việt Nam").city).toBe("ha noi");
    expect(destinationKey("St. Petersburg").city).toBe("st petersburg");
    expect(foldText("  Łódź  Kraków ")).toBe("lodz krakow");
  });
});
