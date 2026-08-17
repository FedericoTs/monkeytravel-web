import { describe, it, expect } from "vitest";
import {
  haversineKm,
  estimateTransfer,
  buildTransferActivity,
  buildJourneyStops,
} from "./transfer-legs";
import { mergeCityItineraries, splitCities, type CityLeg } from "./multi-city-core";
import type { Activity, GeneratedItinerary, ItineraryDay } from "@/types";

const ROME = { lat: 41.9028, lng: 12.4964 };
const FLORENCE = { lat: 43.7696, lng: 11.2558 };
const LISBON = { lat: 38.7223, lng: -9.1393 };

function act(name: string, coords?: { lat: number; lng: number }): Activity {
  return {
    name,
    type: "attraction" as Activity["type"],
    description: "",
    location: "",
    time_slot: "morning",
    start_time: "10:00",
    duration_minutes: 90,
    ...(coords ? { coordinates: coords } : {}),
    estimated_cost: { amount: 0, currency: "EUR", tier: "free" },
    tips: [],
    booking_required: false,
  } as Activity;
}

function cityResult(city: string, days: number, coords?: { lat: number; lng: number }): GeneratedItinerary {
  return {
    destination: { name: city, country: "", description: "", best_for: [], weather_note: "" },
    days: Array.from({ length: days }, (_, i) => ({
      day_number: i + 1,
      date: `2026-09-0${i + 1}`,
      activities: [act(`${city} thing ${i + 1}`, coords)],
    })),
    trip_summary: {
      total_estimated_cost: 100,
      currency: "EUR",
      highlights: [],
      packing_suggestions: [],
    },
  } as GeneratedItinerary;
}

describe("estimateTransfer", () => {
  it("reads short hops as regional trains, mid-range as fast trains, long as flights", () => {
    expect(estimateTransfer(200).mode).toBe("train");
    expect(estimateTransfer(500).mode).toBe("train");
    expect(estimateTransfer(1200).mode).toBe("flight");
  });

  it("falls back to a generic half-day train when distance is unknown", () => {
    expect(estimateTransfer(null)).toMatchObject({ mode: "train", durationMinutes: 180 });
  });

  it("keeps durations plausible (Rome→Florence ≈ 230km ≈ 2-3h door to door)", () => {
    const est = estimateTransfer(haversineKm(ROME, FLORENCE));
    expect(est.mode).toBe("train");
    expect(est.durationMinutes).toBeGreaterThanOrEqual(120);
    expect(est.durationMinutes).toBeLessThanOrEqual(210);
  });
});

describe("mergeCityItineraries + transfer legs", () => {
  const legs: CityLeg[] = [
    { city: "Rome", nights: 2 },
    { city: "Florence", nights: 2 },
  ];

  it("inserts a localized transfer leg on each leg-boundary morning", () => {
    const merged = mergeCityItineraries(
      legs,
      [cityResult("Rome", 2, ROME), cityResult("Florence", 2, FLORENCE)],
      "2026-09-01",
      { language: "it" }
    );
    // Day count unchanged; Florence day 1 gained the transfer at position 0.
    expect(merged.days).toHaveLength(4);
    const boundary = merged.days[2];
    const transfer = boundary.activities[0];
    expect(transfer.type).toBe("transport");
    expect(transfer.transport_mode).toBe("train");
    expect(transfer.name).toBe("Treno per Florence");
    expect(transfer.start_time).toBe("08:30");
    expect(transfer.estimated_cost.currency).toBe("EUR");
    // No transfer before the first city.
    expect(merged.days[0].activities.every((a) => a.type !== "transport")).toBe(true);
  });

  it("flags long hops as flights and respects the insertTransfers opt-out", () => {
    const flown = mergeCityItineraries(
      [{ city: "Rome", nights: 1 }, { city: "Lisbon", nights: 1 }],
      [cityResult("Rome", 1, ROME), cityResult("Lisbon", 1, LISBON)],
      "2026-09-01"
    );
    expect(flown.days[1].activities[0]).toMatchObject({
      type: "transport",
      transport_mode: "flight",
      name: "Flight to Lisbon",
    });

    const bare = mergeCityItineraries(
      legs,
      [cityResult("Rome", 2, ROME), cityResult("Florence", 2, FLORENCE)],
      "2026-09-01",
      { insertTransfers: false }
    );
    expect(bare.days.every((d) => d.activities.every((a) => a.type !== "transport"))).toBe(true);
  });

  it("survives cities with no usable coordinates via the fallback estimate", () => {
    const merged = mergeCityItineraries(
      legs,
      [cityResult("Rome", 2), cityResult("Florence", 2)],
      "2026-09-01"
    );
    expect(merged.days[2].activities[0]).toMatchObject({
      type: "transport",
      duration_minutes: 180,
    });
  });
});

describe("buildJourneyStops", () => {
  it("derives stops with transit labels from the merged transfer legs", () => {
    const merged = mergeCityItineraries(
      [{ city: "Rome", nights: 2 }, { city: "Florence", nights: 1 }],
      [cityResult("Rome", 2, ROME), cityResult("Florence", 1, FLORENCE)],
      "2026-09-01",
      { language: "it" }
    );
    const stops = buildJourneyStops(merged.days, "it");
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ city: "Rome", nights: 2 });
    expect(stops[0].transitFromPrev).toBeUndefined();
    expect(stops[1].nights).toBe(1);
    expect(stops[1].transitFromPrev).toMatch(/^TRENO · \d+h/);
  });

  it("returns plain stops (no label) for pre-P4 trips without transfer legs", () => {
    const days: ItineraryDay[] = [
      { day_number: 1, date: "2026-09-01", activities: [act("A")], city: "Rome" },
      { day_number: 2, date: "2026-09-02", activities: [act("B")], city: "Florence" },
    ];
    const stops = buildJourneyStops(days);
    expect(stops[1]).toEqual({ city: "Florence", nights: 1 });
  });

  it("returns [] for single-city (untagged) trips", () => {
    expect(
      buildJourneyStops([{ day_number: 1, date: "2026-09-01", activities: [act("A")] }])
    ).toEqual([]);
  });
});

describe("splitCities (the un-escaped \\s regex fix)", () => {
  it('no longer eats trailing "s" characters: "Paris, Rome & Milan" stays Paris', () => {
    // The old /s*(?:,|&)s*/ produced ["Pari", "Rome", "Milan"].
    expect(splitCities("Paris, Rome & Milan")).toEqual(["Paris", "Rome", "Milan"]);
  });

  it("splits two-city routes and keeps plain freetext single", () => {
    expect(splitCities("Naples & Rome")).toEqual(["Naples", "Rome"]);
    // No " & " → not a route; "City, Country" freetext stays whole.
    expect(splitCities("Paris, France")).toEqual(["Paris, France"]);
  });
});
