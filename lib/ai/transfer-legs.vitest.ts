import { describe, it, expect } from "vitest";
import {
  haversineKm,
  estimateTransfer,
  buildTransferActivity,
  buildJourneyStops,
  dayWithTransfer,
  inRailRegion,
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
    expect(transfer.estimated_cost?.currency).toBe("EUR");
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

const HANOI = { lat: 21.0285, lng: 105.8542 };
const HA_LONG = { lat: 20.9101, lng: 107.1839 };
const PLACEHOLDER = { lat: 48.0012, lng: 10.0034 };
const timed = (name: string, start: string, minutes: number): Activity => ({ ...act(name), start_time: start, duration_minutes: minutes });

describe("transfer modes", () => {
  it("knows where trains are the usual way between cities", () => {
    expect(inRailRegion(ROME)).toBe(true);
    expect(inRailRegion({ lat: 35.68, lng: 139.69 })).toBe(true);
    expect(inRailRegion(HANOI)).toBe(false);
    expect(inRailRegion({ lat: 13.75, lng: 100.5 })).toBe(false);
  });

  it("names no mode for a ground hop elsewhere, and flies the long ones", () => {
    expect(estimateTransfer(150, false)).toMatchObject({ mode: "ground", durationMinutes: 180 });
    expect(estimateTransfer(600, false).mode).toBe("flight");
    expect(estimateTransfer(null, false)).toMatchObject({ mode: "ground", durationMinutes: 180 });
  });

  it("calls Hanoi to Ha Long a transfer, not a train, on the card and the ribbon", () => {
    const merged = mergeCityItineraries(
      [{ city: "Hanoi", nights: 1 }, { city: "Ha Long Bay", nights: 1 }],
      [cityResult("Hanoi", 1, HANOI), cityResult("Ha Long Bay", 1, HA_LONG)],
      "2026-11-01"
    );
    expect(merged.days[1].activities[0]).toMatchObject({ transport_mode: "ground", name: "Transfer to Ha Long Bay" });
    expect(buildJourneyStops(merged.days)[1].transitFromPrev).toMatch(/^TRANSFER · /);
  });

  it("prices the hop in USD when the trip's currency isn't dollar-sized", () => {
    const leg = (currency: string) =>
      buildTransferActivity({ fromCity: "Hanoi", toCity: "Ha Long Bay", fromDays: [], toDays: [], currency }).estimated_cost?.currency;
    expect(leg("VND")).toBe("USD");
    expect(leg("EUR")).toBe("EUR");
  });

  it("measures the hop from real pins, not the placeholder point", () => {
    const transfer = buildTransferActivity({
      fromCity: "Cape Town",
      toCity: "Durban",
      fromDays: [{ day_number: 1, date: "2026-11-01", activities: [act("Table Mountain", { lat: -33.96, lng: 18.4 })] }],
      toDays: [{ day_number: 1, date: "2026-11-02", activities: [act("Somewhere", PLACEHOLDER), act("Moses Mabhida", { lat: -29.83, lng: 31.03 })] }],
      currency: "ZAR",
    });
    expect(transfer.transport_mode).toBe("flight");
    expect(transfer.duration_minutes).toBeLessThan(6 * 60);
  });
});

describe("dayWithTransfer", () => {
  const transfer = { ...act("Train to Florence"), type: "transport", start_time: "08:30", duration_minutes: 180 } as Activity;

  it("keeps what ends before leaving or starts after arriving, and moves what overlaps to the first gap that holds it", () => {
    const day = dayWithTransfer(transfer, [
      timed("Breakfast", "07:30", 45),
      timed("Uffizi", "09:00", 120),
      timed("Lunch", "13:00", 60),
      timed("Boboli", "15:00", 120),
      timed("Dinner", "19:30", 90),
    ]);
    expect(day.map((a) => `${a.start_time} ${a.name}`)).toEqual([
      "07:30 Breakfast",
      "08:30 Train to Florence",
      "13:00 Lunch",
      "15:00 Boboli",
      "17:00 Uffizi",
      "19:30 Dinner",
    ]);
    expect(day.find((a) => a.name === "Uffizi")?.time_slot).toBe("evening");
  });

  it("leaves out a meal that would move far from its time, and the plan's own trip from the last city", () => {
    const flight = { ...transfer, name: "Flight to Hoi An", location: "Hanoi", duration_minutes: 200 } as Activity;
    const day = dayWithTransfer(flight, [
      { ...timed("Transfer from Hanoi to Hoi An", "07:30", 60), type: "transport" } as Activity,
      { ...timed("Lunch at Banh Mi Phuong", "12:00", 90), type: "restaurant" } as Activity,
      timed("Japanese Covered Bridge", "13:30", 90),
      timed("Silk Village", "15:00", 150),
      { ...timed("Dinner at Morning Glory", "19:00", 120), type: "restaurant" } as Activity,
    ]);
    expect(day.map((a) => a.name)).toEqual(["Flight to Hoi An", "Japanese Covered Bridge", "Silk Village", "Dinner at Morning Glory"]);
    // A short move keeps it: arriving 12:20, lunch planned at 12:00 can be at 12:20.
    const near = dayWithTransfer(flight, [{ ...timed("Lunch at Banh Mi Phuong", "12:00", 60), type: "restaurant" } as Activity, timed("Bridge", "14:00", 60)]);
    expect(near.map((a) => `${a.start_time} ${a.name}`)).toEqual(["08:30 Flight to Hoi An", "12:20 Lunch at Banh Mi Phuong", "14:00 Bridge"]);
  });

  it("leaves out what no gap holds by 20:00", () => {
    // Arriving at 17:00, three hours of museum would run into dinner and past 20:00.
    const day = dayWithTransfer({ ...transfer, duration_minutes: 480 }, [timed("Museum", "09:00", 180), timed("Dinner", "19:00", 90)]);
    expect(day.map((a) => a.name)).toEqual(["Train to Florence", "Dinner"]);
    // Arriving at 16:00, it fits right before dinner.
    const fits = dayWithTransfer({ ...transfer, duration_minutes: 420 }, [timed("Museum", "09:00", 180), timed("Dinner", "19:00", 90)]);
    expect(fits.map((a) => `${a.start_time} ${a.name}`)).toEqual(["08:30 Train to Florence", "16:00 Museum", "19:00 Dinner"]);
  });
});
