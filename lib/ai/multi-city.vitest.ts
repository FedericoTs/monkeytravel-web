import { describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** Each city of a multi-city trip starts from the places travellers kept there. */

const generated: Array<{ destination: string; knownPlaces: unknown }> = [];
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async (p: TripCreationParams, options: { knownPlaces?: unknown }) => {
    generated.push({ destination: p.destination, knownPlaces: options.knownPlaces });
    const nights = (Date.parse(p.endDate) - Date.parse(p.startDate)) / 864e5 + 1;
    return {
      destination: { name: p.destination, country: "Italy", description: "" },
      days: Array.from({ length: nights }, (_, i) => ({ day_number: i + 1, date: p.startDate, theme: "t", activities: [] })),
    };
  },
}));
vi.mock("./known-places", () => ({
  knownPlacesFor: async (p: TripCreationParams, days: number, language: string) => [
    { name: `${p.destination} for ${days} days in ${language}`, type: "landmark" },
  ],
}));

const { generateMultiCityItinerary } = await import("./multi-city");

describe("generateMultiCityItinerary", () => {
  it("offers each city its own known places, for its own nights", async () => {
    const base = { budgetTier: "balanced", pace: "moderate", vibes: ["cultural"], interests: [] } as unknown as Parameters<
      typeof generateMultiCityItinerary
    >[0];
    await generateMultiCityItinerary(
      base,
      [
        { city: "Rome", nights: 3 },
        { city: "Florence", nights: 2 },
      ],
      "2027-05-01",
      { language: "it" }
    );
    expect(generated).toEqual([
      { destination: "Rome", knownPlaces: [{ name: "Rome for 3 days in it", type: "landmark" }] },
      { destination: "Florence", knownPlaces: [{ name: "Florence for 2 days in it", type: "landmark" }] },
    ]);
  });
});
