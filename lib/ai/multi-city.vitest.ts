import { describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** Each city of a multi-city trip starts from the places travellers kept there. */

const generated: Array<{ destination: string; knownPlaces: unknown }> = [];
const asked: Array<{ destination: string; mustDos?: string[] }> = [];
/** The route each city was given. */
const routes: Array<TripCreationParams["destinations"]> = [];
/** A city's places for each of its days, when a test gives them. */
let placesFor: ((p: TripCreationParams, call: number) => Array<Array<[string, number, number]>>) | null = null;
/** The sunrise and sunset each city was planned with. */
const daylights: Array<{ destination: string; daylight: TripCreationParams["daylight"] }> = [];
/** What each city was told is on there. */
const whatsOns: Array<{ destination: string; whatsOn: TripCreationParams["whatsOn"] }> = [];
/** Where the cities table puts each city, when a test says. */
let pointsByCity: Record<string, { lat: number; lng: number }> = {};
vi.mock("./city-points", () => ({
  cityPointsFor: async (cities: string[]) => cities.map((c) => pointsByCity[c] ?? null),
}));
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async (p: TripCreationParams, options: { knownPlaces?: unknown }) => {
    daylights.push({ destination: p.destination, daylight: p.daylight });
    whatsOns.push({ destination: p.destination, whatsOn: p.whatsOn });
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
const { daylightFor } = await import("./daylight");

describe("generateMultiCityItinerary", () => {
  // A route sends no one place's coordinates, so its cities were planned with no sunrise or sunset, and a sunset
  // stop could sit hours from the sun.
  it("plans each city with its own sunrise and sunset, on its own dates, where the city is known", async () => {
    pointsByCity = { Reykjavik: { lat: 64.15, lng: -21.94 }, Lisbon: { lat: 38.72, lng: -9.14 } };
    daylights.length = 0;
    const base = { budgetTier: "balanced", pace: "moderate", vibes: [], interests: [] } as unknown as Parameters<typeof generateMultiCityItinerary>[0];
    await generateMultiCityItinerary(
      base,
      [{ city: "Reykjavik", nights: 2 }, { city: " Lisbon ", nights: 3 }, { city: "Nowhere", nights: 1 }],
      "2027-06-01"
    );
    const of = (city: string) => daylights.find((d) => d.destination.trim() === city)?.daylight;
    expect(of("Reykjavik")).toEqual(daylightFor({ lat: 64.15, lng: -21.94 }, "2027-06-01", "2027-06-02"));
    expect(of("Lisbon")).toEqual(daylightFor({ lat: 38.72, lng: -9.14 }, "2027-06-03", "2027-06-05"));
    expect(of("Lisbon")?.first.sunset).not.toEqual(of("Reykjavik")?.first.sunset);
    expect(of("Nowhere")).toBeUndefined();
    pointsByCity = {};
    for (const list of [generated, asked, routes, events, daylights] as unknown[][]) list.length = 0;
  });

  it("tells each city what's on there, on its own dates", async () => {
    pointsByCity = { Prague: { lat: 50.0755, lng: 14.4378 }, Bangkok: { lat: 13.7563, lng: 100.5018 } };
    whatsOns.length = 0;
    const base = { budgetTier: "balanced", pace: "moderate", vibes: [], interests: [] } as unknown as Parameters<typeof generateMultiCityItinerary>[0];
    // Prague 20-22 December, then Bangkok 23-25 December.
    await generateMultiCityItinerary(base, [{ city: "Prague", nights: 3 }, { city: "Bangkok", nights: 3 }, { city: "Nowhere", nights: 1 }], "2026-12-20");
    const of = (city: string) => whatsOns.find((w) => w.destination === city)?.whatsOn;
    expect(of("Prague")).toEqual([expect.stringMatching(/Christmas markets are open/)]);
    expect(of("Bangkok")).toEqual([]);
    expect(of("Nowhere")).toEqual([]);
    pointsByCity = {};
    for (const list of [generated, asked, routes, events, daylights, whatsOns] as unknown[][]) list.length = 0;
  });

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

  // A city written at its longitude's mirror, in China: the card from the city before was a day-long flight that took
  // its first day, and the trip closed with a flight back.
  it("puts a city whose stops came back on the far side of the world back on the route before the cards between are made", async () => {
    pointsByCity = { Flagstaff: { lat: 35.1983, lng: -111.6513 } };
    placesFor = (p) =>
      p.destination === "Sedona"
        ? [[["Cathedral Rock", 34.82, -111.793], ["Chapel of the Holy Cross", 34.8325, -111.7667]]]
        : [[["Lowell Observatory", 35.2029, 111.6646], ["Museum of Northern Arizona", 35.2347, 111.6655]]];
    hopsAnswer = [{ mode: "car", minutes: 45 }, { mode: "car", minutes: 45 }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { budgetTier: "balanced", pace: "moderate", vibes: [], interests: [] } as unknown as Parameters<typeof generateMultiCityItinerary>[0];
    const plan = await generateMultiCityItinerary(base, [{ city: "Sedona", nights: 1 }, { city: "Flagstaff", nights: 1 }], "2027-05-01");
    expect(plan.days[1].activities[0]).toMatchObject({ name: "Transfer to Flagstaff", transport_mode: "ground", duration_minutes: 80 });
    // Its stops keep their day, and Flagstaff is under an hour from where the trip began: no way back after them.
    expect(plan.days[1].activities.slice(1).map((a) => [a.name, a.coordinates?.lng])).toEqual([
      ["Lowell Observatory", -111.6646],
      ["Museum of Northern Arizona", -111.6655],
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Flagstaff"));
    warn.mockRestore();
    pointsByCity = {};
    placesFor = null;
    hopsAnswer = [];
  });
});
