import { describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** Each city of a multi-city trip starts from the places travellers kept there. */

const generated: Array<{ destination: string; knownPlaces: unknown }> = [];
const asked: Array<{ destination: string; mustDos?: string[] }> = [];
/** The route each city was given. */
const routes: Array<TripCreationParams["destinations"]> = [];
/** A city's places for each of its days, when a test gives them. */
let placesFor: ((p: TripCreationParams, call: number) => Array<Array<[string, number, number]>>) | null = null;
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async (p: TripCreationParams, options: { knownPlaces?: unknown }) => {
    events.push(`plan ${p.destination}`);
    generated.push({ destination: p.destination, knownPlaces: options.knownPlaces });
    asked.push({ destination: p.destination, mustDos: p.mustDos });
    routes.push(p.destinations);
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
/** What happened, in order: the question of each hop's way, and each city's plan. */
const events: string[] = [];
let hopsAnswer: Array<{ mode: string; minutes: number } | undefined> = [];
vi.mock("./transfer-question", () => ({
  askForTransfers: async (cities: string[]) => {
    events.push(`hops ${cities.join(" > ")}`);
    return { hops: hopsAnswer, costUsd: 0 };
  },
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

  // Each city was planned from its name alone: "cordoba" on a trip through Argentina came back as Córdoba, Spain.
  it("gives each city the whole route, so a name that fits several places means the one on it", async () => {
    routes.length = 0;
    const legs = [
      { city: "buenos aires", nights: 2 },
      { city: "cordoba", nights: 2 },
      { city: "mendoza", nights: 2 },
    ];
    const base = { budgetTier: "balanced", pace: "moderate", vibes: [], interests: [] } as unknown as Parameters<typeof generateMultiCityItinerary>[0];
    await generateMultiCityItinerary(base, legs, "2027-03-10");
    expect(routes).toEqual([legs, legs, legs]);
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

  // The card between two cities was an estimate from straight-line distance: Brussels to Paris took three and a half hours.
  it("asks how travellers make each hop while the cities are planned, and the cards between them follow the answer", async () => {
    events.length = 0;
    placesFor = (p) => {
      const city = p.destination.trim();
      return city === "Brussels" ? [[["Grand-Place", 50.8467, 4.3525]]] : city === "Paris" ? [[["Louvre", 48.8606, 2.3376]]] : [[["Belem Tower", 38.6916, -9.216]]];
    };
    hopsAnswer = [{ mode: "train", minutes: 82 }, { mode: "train", minutes: 30 }, { mode: "flight", minutes: 155 }];
    const base = { budgetTier: "balanced", pace: "moderate", vibes: [], interests: [] } as unknown as Parameters<typeof generateMultiCityItinerary>[0];
    const reports: unknown[] = [];
    const plan = await generateMultiCityItinerary(
      base,
      [{ city: "Brussels", nights: 1 }, { city: " Paris ", nights: 1 }, { city: "Lisbon", nights: 1 }],
      "2027-05-01",
      undefined,
      (report) => reports.push(report)
    );
    // The same question asks the way back from the last city to the first.
    expect(events).toEqual(["hops Brussels > Paris > Lisbon > Brussels", "plan Brussels", "plan  Paris ", "plan Lisbon"]);
    expect(plan.days[1].activities[0]).toMatchObject({ name: "Train to Paris", duration_minutes: 110 });
    // A train from Paris to Lisbon in half an hour can't be right: the card keeps the estimate.
    expect(plan.days[2].activities[0]).toMatchObject({ name: "Flight to Lisbon" });
    expect(plan.days[2].activities.at(-1)).toMatchObject({ name: "Flight to Brussels", duration_minutes: 310 });
    // The report counts the hops between the cities, not the way back.
    expect(reports).toEqual([{ hops: 2, answered: 2, used: 1 }]);
    // No answer for the hop: its card is the estimate, and the report says so.
    hopsAnswer = [undefined];
    reports.length = 0;
    const estimated = await generateMultiCityItinerary(base, [{ city: "Brussels", nights: 1 }, { city: "Paris", nights: 1 }], "2027-05-01", undefined, (r) => reports.push(r));
    expect(estimated.days[1].activities[0].duration_minutes).toBe(210);
    expect(reports).toEqual([{ hops: 1, answered: 0, used: 0 }]);
    // A route that comes back to where it began asks no way back.
    events.length = 0;
    await generateMultiCityItinerary(base, [{ city: "Brussels", nights: 1 }, { city: "Paris", nights: 1 }, { city: "brussels ", nights: 1 }], "2027-05-01");
    expect(events[0]).toBe("hops Brussels > Paris > brussels");
    placesFor = null;
  });
});
