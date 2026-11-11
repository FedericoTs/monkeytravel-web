import { describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** Each city of a multi-city trip starts from the places travellers kept there. */

const generated: Array<{ destination: string; knownPlaces: unknown }> = [];
const asked: Array<{ destination: string; mustDos?: string[] }> = [];
/** A city's places for each of its days, when a test gives them. */
let placesFor: ((p: TripCreationParams, call: number) => Array<Array<[string, number, number]>>) | null = null;
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async (p: TripCreationParams, options: { knownPlaces?: unknown }) => {
    generated.push({ destination: p.destination, knownPlaces: options.knownPlaces });
    asked.push({ destination: p.destination, mustDos: p.mustDos });
    const nights = (Date.parse(p.endDate) - Date.parse(p.startDate)) / 864e5 + 1;
    const call = asked.filter((a) => a.destination === p.destination).length;
    const places = placesFor?.(p, call);
    return {
      destination: { name: p.destination, country: "Italy", description: "" },
      days: Array.from({ length: nights }, (_, i) => ({
        day_number: i + 1,
        date: p.startDate,
        theme: "t",
        activities: (places?.[i] ?? []).map(([name, lat, lng]) => ({ name, type: "attraction", time_slot: "morning", start_time: "10:00", coordinates: { lat, lng } })),
      })),
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

  // Live, Seoul's plan still put six of Busan's must-dos on its days, and its
  // last day was left empty once they came off.
  it("asks a city that planned another city's must-dos once more, without them", async () => {
    asked.length = 0;
    const busan: Array<[string, number, number]> = [["Gamcheon Culture Village", 35.0975, 129.0106], ["Jagalchi Market", 35.0966, 129.0306]];
    const seoul: Array<[string, number, number]> = [["Gyeongbokgung Palace", 37.5796, 126.977], ["N Seoul Tower", 37.5512, 126.9882]];
    placesFor = (p, call) =>
      p.destination === "Busan"
        ? [busan, [["Haeundae Beach", 35.1587, 129.1604]]]
        : call === 1
          ? [seoul, [["Gamcheon Culture Village", 35.0975, 129.0106]]]
          : [seoul, [["Bukchon Hanok Village", 37.5826, 126.9831]]];
    const base = {
      budgetTier: "balanced",
      pace: "moderate",
      vibes: [],
      interests: [],
      mustDos: ["gamcheon culture village", "gyeongbokgung palace"],
    } as unknown as Parameters<typeof generateMultiCityItinerary>[0];
    const plan = await generateMultiCityItinerary(base, [{ city: "Busan", nights: 2 }, { city: "Seoul", nights: 2 }], "2027-05-01");
    expect(asked).toEqual([
      { destination: "Busan", mustDos: ["gamcheon culture village", "gyeongbokgung palace"] },
      { destination: "Seoul", mustDos: ["gamcheon culture village", "gyeongbokgung palace"] },
      { destination: "Seoul", mustDos: ["gyeongbokgung palace"] },
    ]);
    expect(plan.days.map((d) => d.activities.filter((a) => a.type !== "transport").map((a) => a.name))).toEqual([
      ["Gamcheon Culture Village", "Jagalchi Market"],
      ["Haeundae Beach"],
      ["Gyeongbokgung Palace", "N Seoul Tower"],
      ["Bukchon Hanok Village"],
    ]);
    // With no must-dos, a stray place only comes off.
    asked.length = 0;
    await generateMultiCityItinerary({ ...base, mustDos: undefined }, [{ city: "Busan", nights: 2 }, { city: "Seoul", nights: 2 }], "2027-05-01");
    expect(asked.map((a) => a.destination)).toEqual(["Busan", "Seoul"]);
    placesFor = null;
  });
});
