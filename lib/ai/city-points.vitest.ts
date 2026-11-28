import { describe, expect, it, vi } from "vitest";
import { chooseCityPoints, cityPointsFor, type CityCandidate } from "./city-points";

const at = (name: string, latitude: number, longitude: number, population = 1000, ascii_name = name): CityCandidate => ({
  name,
  ascii_name,
  latitude,
  longitude,
  population,
});

describe("chooseCityPoints", () => {
  it("takes a city's own name, not one that only starts like it", () => {
    const found = [[at("Edinburgh", 55.95, -3.19, 500_000)], [at("Obando", 14.71, 120.94, 59_929), at("Oban", 56.42, -5.47, 8_140)]];
    expect(chooseCityPoints(found, ["Edinburgh", "Oban"])).toEqual([
      { lat: 55.95, lng: -3.19 },
      { lat: 56.42, lng: -5.47 },
    ]);
  });

  it("says the chosen place's country when the table names it", () => {
    const found = [[{ ...at("Kochi", 9.93, 76.26, 600_000), country_code: "IN" }, { ...at("Kochi", 33.56, 133.53, 330_000), country_code: "JP" }]];
    expect(chooseCityPoints(found, ["kochi"])).toEqual([{ lat: 9.93, lng: 76.26, country: "IN" }]);
  });

  it("takes the place of that name nearest the route's other cities, written with or without its accents", () => {
    const found = [
      [at("Madrid", 40.42, -3.7, 3_000_000)],
      [at("Córdoba", -31.41, -64.19, 2_100_000, "Cordoba"), at("Córdoba", 37.89, -4.77, 325_708, "Cordoba")],
      [at("Seville", 37.39, -5.98, 700_000)],
    ];
    expect(chooseCityPoints(found, ["Madrid", "cordoba", "Seville"])[1]).toEqual({ lat: 37.89, lng: -4.77 });
    expect(chooseCityPoints(found, ["Madrid", "Córdoba", "Seville"])[1]).toEqual({ lat: 37.89, lng: -4.77 });
  });

  it("keeps a far end of a long route, and knows nothing of a city it can't find or one across the world", () => {
    const found = [[at("Ubud", -8.51, 115.27)], [], [at("Darwin", -12.46, 130.84)], [at("Paris", 48.86, 2.35)]];
    expect(chooseCityPoints(found, ["Ubud", "Nusa Penida", "Darwin", "Paris"])).toEqual([
      { lat: -8.51, lng: 115.27 },
      null,
      { lat: -12.46, lng: 130.84 },
      null,
    ]);
  });

  it("keeps both ends of a long route of two cities", () => {
    const found = [[at("Lisbon", 38.72, -9.14)], [at("Istanbul", 41.01, 28.98)]];
    expect(chooseCityPoints(found, ["Lisbon", "Istanbul"])).toEqual([
      { lat: 38.72, lng: -9.14 },
      { lat: 41.01, lng: 28.98 },
    ]);
  });

  it("takes a name written the plain way the table keeps it too", () => {
    const found = [[at("Köln", 50.94, 6.96, 1_000_000, "Koeln")], [at("Düsseldorf", 51.22, 6.78, 600_000, "Duesseldorf")]];
    expect(chooseCityPoints(found, ["Koeln", "Düsseldorf"])).toEqual([
      { lat: 50.94, lng: 6.96 },
      { lat: 51.22, lng: 6.78 },
    ]);
  });

  it("knows none when nothing matches", () => {
    expect(chooseCityPoints([[], [at("Obando", 14.71, 120.94)]], ["Atlantis", "Oban"])).toEqual([null, null]);
  });
});

describe("cityPointsFor", () => {
  it("asks for each city by its plain name, and knows none where the lookup fails or there is no database", async () => {
    const asked: string[] = [];
    const db = {
      rpc: vi.fn(async (_fn: string, args: { q: string }) => {
        asked.push(args.q);
        if (args.q === "lisboa") return { data: null, error: { message: "boom" } };
        return { data: args.q === "sevilla" ? [at("Sevilla", 37.39, -5.98)] : [], error: null };
      }),
    };
    expect(await cityPointsFor([" Sevilla ", "Lisboa", "Málaga_%", "X"], db)).toEqual([{ lat: 37.39, lng: -5.98 }, null, null, null]);
    expect(asked).toEqual(["sevilla", "lisboa", "malaga"]);
    expect(await cityPointsFor(["Sevilla"], null)).toEqual([null]);
  });
});
