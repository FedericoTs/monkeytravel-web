import { describe, expect, it } from "vitest";
import { MOOD_EMOJIS, destinationGradient } from "./visuals";

describe("destinationGradient", () => {
  it("picks the city's gradient from a full destination", () => {
    expect(destinationGradient("Paris, France")).toEqual({ from: "#E8B4B8", to: "#D4919A" });
    expect(destinationGradient("  New York, USA")).toEqual({ from: "#667EEA", to: "#764BA2" });
  });

  it("has a gradient for every city the template cards know, on the templates page too", () => {
    for (const city of ["London", "Dubai", "Amsterdam", "Santorini", "Iceland"]) {
      expect(destinationGradient(city)).not.toEqual(destinationGradient("Nowhere"));
    }
  });

  it("is grey for a city without one", () => {
    expect(destinationGradient("Nowhere, Atlantis")).toEqual({ from: "#718096", to: "#4A5568" });
  });
});

describe("MOOD_EMOJIS", () => {
  it("covers the template moods", () => {
    expect(Object.keys(MOOD_EMOJIS).sort()).toEqual(
      ["adventure", "cultural", "family", "foodie", "nature", "offbeat", "relaxation", "romantic", "urban", "wellness"],
    );
  });
});
