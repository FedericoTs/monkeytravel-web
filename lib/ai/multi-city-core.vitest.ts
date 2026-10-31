import { describe, it, expect } from "vitest";
import type { GeneratedItinerary } from "@/types";
import {
  joinCities,
  addDaysISO,
  validateLegs,
  mergeCityItineraries,
  MultiCityError,
  type CityLeg,
} from "./multi-city-core";

function cityResult(
  name: string,
  days: number,
  opts: {
    cost?: number;
    bestFor?: string[];
    packing?: string[];
    highlights?: string[];
    hotels?: { provider: string; url: string; label: string }[];
  } = {}
): GeneratedItinerary {
  return {
    destination: {
      name,
      country: `${name}land`,
      description: `${name} description`,
      best_for: opts.bestFor ?? [],
      weather_note: `${name} weather`,
    },
    // Per-city days come back numbered 1..N with their own sub-range dates;
    // the merge must renumber + re-date them globally.
    days: Array.from({ length: days }, (_, i) => ({
      day_number: i + 1,
      date: "2000-01-01",
      activities: [],
    })),
    trip_summary: {
      total_estimated_cost: opts.cost ?? 0,
      currency: "USD",
      highlights: opts.highlights ?? [],
      packing_suggestions: opts.packing ?? [],
    },
    booking_links: opts.hotels
      ? { flights: [{ provider: "Sky", url: "u", label: "l" }], hotels: opts.hotels }
      : undefined,
  };
}

describe("joinCities", () => {
  it("formats 0/1/2/3 cities", () => {
    expect(joinCities([])).toBe("");
    expect(joinCities(["Rome"])).toBe("Rome");
    expect(joinCities(["Rome", "Paris"])).toBe("Rome & Paris");
    expect(joinCities(["Rome", "Paris", "Berlin"])).toBe("Rome, Paris & Berlin");
  });
  it("trims + drops blanks", () => {
    expect(joinCities([" Rome ", "", "  ", "Paris"])).toBe("Rome & Paris");
  });
});

describe("addDaysISO", () => {
  it("adds days and crosses a month boundary", () => {
    expect(addDaysISO("2026-05-10", 0)).toBe("2026-05-10");
    expect(addDaysISO("2026-05-10", 4)).toBe("2026-05-14");
    expect(addDaysISO("2026-05-30", 3)).toBe("2026-06-02");
  });
  it("throws on an invalid date", () => {
    expect(() => addDaysISO("not-a-date", 1)).toThrow(MultiCityError);
  });
});

describe("validateLegs", () => {
  const ok: CityLeg[] = [
    { city: "Rome", nights: 3 },
    { city: "Paris", nights: 2 },
  ];
  it("accepts valid legs", () => {
    expect(() => validateLegs(ok)).not.toThrow();
    expect(() => validateLegs(ok, 5)).not.toThrow();
  });
  it("rejects empty / too many", () => {
    expect(() => validateLegs([])).toThrow(MultiCityError);
    expect(() =>
      validateLegs([
        { city: "A", nights: 1 },
        { city: "B", nights: 1 },
        { city: "C", nights: 1 },
        { city: "D", nights: 1 },
        { city: "E", nights: 1 },
        { city: "F", nights: 1 },
      ])
    ).toThrow(/at most 5/);
  });
  it("rejects missing name / bad nights", () => {
    expect(() => validateLegs([{ city: "  ", nights: 1 }])).toThrow(/name/);
    expect(() => validateLegs([{ city: "Rome", nights: 0 }])).toThrow(/night/);
    expect(() => validateLegs([{ city: "Rome", nights: 1.5 }])).toThrow(/night/);
  });
  it("rejects a nights-vs-trip-length mismatch", () => {
    expect(() => validateLegs(ok, 6)).toThrow(/sum to the trip length/);
  });
});

describe("mergeCityItineraries", () => {
  const legs: CityLeg[] = [
    { city: "Rome", nights: 3 },
    { city: "Paris", nights: 2 },
  ];
  const results = [
    cityResult("Rome", 3, {
      cost: 300,
      bestFor: ["food", "art"],
      packing: ["shoes"],
      highlights: ["Colosseum"],
      hotels: [{ provider: "B", url: "r", label: "Rome hotel" }],
    }),
    cityResult("Paris", 2, {
      cost: 200,
      bestFor: ["art", "wine"],
      packing: ["shoes", "umbrella"],
      highlights: ["Louvre"],
      hotels: [{ provider: "B", url: "p", label: "Paris hotel" }],
    }),
  ];
  const merged = mergeCityItineraries(legs, results, "2026-05-10");

  it("concatenates + renumbers days globally", () => {
    expect(merged.days).toHaveLength(5);
    expect(merged.days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5]);
  });
  it("re-assigns contiguous dates from the trip start", () => {
    expect(merged.days.map((d) => d.date)).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
    ]);
  });
  it("tags each day with its city in order", () => {
    expect(merged.days.map((d) => d.city)).toEqual([
      "Rome",
      "Rome",
      "Rome",
      "Paris",
      "Paris",
    ]);
  });
  it("builds the combined destination label", () => {
    expect(merged.destination.name).toBe("Rome & Paris");
  });
  it("sums cost, the transfer between the cities included, and merges/dedupes summary fields", () => {
    const transfer = merged.days[3].activities.find((a) => a.transport_mode)!;
    expect(transfer.estimated_cost).toMatchObject({ amount: 40, currency: "USD" });
    expect(merged.trip_summary.total_estimated_cost).toBe(540);
    expect(merged.destination.best_for).toEqual(["food", "art", "wine"]);
    expect(merged.trip_summary.packing_suggestions).toEqual(["shoes", "umbrella"]);
    expect(merged.trip_summary.highlights).toEqual(["Colosseum", "Louvre"]);
  });
  it("searches a stay per city, to the morning the next city starts, and flies one way into the first", () => {
    const hotels = merged.booking_links?.hotels ?? [];
    expect(hotels.map((h) => `${h.provider} · ${h.city}`)).toEqual([
      "Booking.com · Rome",
      "Airbnb · Rome",
      "Booking.com · Paris",
      "Airbnb · Paris",
    ]);
    expect(hotels[0].url).toContain("checkin=2026-05-10&checkout=2026-05-13");
    expect(hotels[2].url).toContain("checkin=2026-05-13&checkout=2026-05-14");
    const flights = merged.booking_links?.flights ?? [];
    expect(flights).toHaveLength(1);
    expect(new URL(flights[0].url).searchParams.get("q")).toBe("One way flights to Rome on 2026-05-10");
  });

  it("gives a one-night stop a one-night stay", () => {
    const short = mergeCityItineraries(
      [{ city: "Rome", nights: 1 }, { city: "Paris", nights: 1 }],
      [cityResult("Rome", 1), cityResult("Paris", 1)],
      "2026-05-10"
    );
    const hotels = short.booking_links?.hotels ?? [];
    expect(hotels[0].url).toContain("checkin=2026-05-10&checkout=2026-05-11");
    expect(hotels[2].url).toContain("checkin=2026-05-11&checkout=2026-05-12");
  });
  it("adds a transfer to the total only in the trip's currency, and none when transfers are off", () => {
    const vnd = (name: string) => {
      const r = cityResult(name, 1, { cost: 1_000_000 });
      r.trip_summary.currency = "VND";
      return r;
    };
    const twoCities = [{ city: "Hanoi", nights: 1 }, { city: "Hue", nights: 1 }];
    expect(mergeCityItineraries(twoCities, [vnd("Hanoi"), vnd("Hue")], "2026-05-10").trip_summary.total_estimated_cost).toBe(2_000_000);
    expect(
      mergeCityItineraries(legs, results, "2026-05-10", { insertTransfers: false }).trip_summary.total_estimated_cost
    ).toBe(500);
  });
  it("throws when legs and results lengths differ", () => {
    expect(() => mergeCityItineraries(legs, [results[0]], "2026-05-10")).toThrow(
      MultiCityError
    );
  });
});
