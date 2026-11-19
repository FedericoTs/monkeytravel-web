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

  it("crosses to and between islands by sea or air, and takes a train only on an island with a railway", () => {
    const at = (lat: number, lng: number) => ({ lat, lng });
    const leg = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, toCity: string) =>
      buildTransferActivity({
        fromCity: "From",
        toCity,
        fromDays: [{ day_number: 1, date: "2026-11-01", activities: [act("there", from)] }],
        toDays: [{ day_number: 2, date: "2026-11-02", activities: [act("here", to)] }],
        currency: "EUR",
      });
    const ATHENS = at(37.9755, 23.7348);
    const SANTORINI = at(36.4167, 25.4318);
    expect(leg(ATHENS, SANTORINI, "Santorini")).toMatchObject({ transport_mode: "ground", name: "Transfer to Santorini" });
    expect(leg(SANTORINI, at(37.4467, 25.3289), "Mykonos").transport_mode).toBe("ground");
    expect(leg(at(41.3874, 2.1686), at(39.5696, 2.6502), "Palma").transport_mode).toBe("ground");
    expect(leg(at(35.5138, 24.018), at(35.3387, 25.1442), "Heraklion").transport_mode).toBe("ground");
    expect(leg(at(37.5665, 126.978), at(33.4996, 126.5312), "Jeju").transport_mode).toBe("flight");
    expect(leg(at(51.5072, -0.1276), at(53.3498, -6.2603), "Dublin").transport_mode).toBe("flight");
    // Trains run on Mallorca, Sardinia and Ireland, and on the mainland as before.
    expect(leg(at(39.5696, 2.6502), at(39.7667, 2.7154), "Sóller").transport_mode).toBe("train");
    expect(leg(at(39.2238, 9.1217), at(40.9235, 9.4964), "Olbia").transport_mode).toBe("train");
    expect(leg(at(53.3498, -6.2603), at(51.8985, -8.4756), "Cork").transport_mode).toBe("train");
    expect(leg(ROME, FLORENCE, "Florence").transport_mode).toBe("train");
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

  // A café the model placed far away was the first point of Seoul's plan: the
  // train from Busan became a flight, and the arrival day lost its places.
  it("measures the hop between the middles of the two cities, so one wrong pin can't move it", () => {
    const busan = [
      { day_number: 1, date: "2026-11-10", activities: [act("Gamcheon", { lat: 35.0975, lng: 129.0106 }), act("Haeundae", { lat: 35.1587, lng: 129.1604 })] },
      { day_number: 2, date: "2026-11-11", activities: [act("Café far away", { lat: 13.75, lng: 100.5 }), act("Jagalchi", { lat: 35.0966, lng: 129.0306 })] },
    ];
    const seoul = [
      { day_number: 1, date: "2026-11-12", activities: [act("Café far away", { lat: 13.75, lng: 100.5 }), act("Gyeongbokgung", { lat: 37.5796, lng: 126.977 }), act("Bukchon", { lat: 37.5826, lng: 126.9831 })] },
    ];
    const transfer = buildTransferActivity({ fromCity: "Busan", toCity: "Seoul", fromDays: busan, toDays: seoul, currency: "KRW" });
    expect(transfer).toMatchObject({ transport_mode: "train", name: "Train to Seoul" });
    expect(transfer.duration_minutes).toBeLessThan(4 * 60);
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

// From straight-line distance the card said three and a half hours from Brussels to Paris (82 minutes by the fast
// train), a train from Istanbul to Cappadocia (travellers fly) and a flight from Jaipur to Jaisalmer.
describe("the way travellers make a hop, as answered", () => {
  const BRUSSELS = { lat: 50.8467, lng: 4.3525 };
  const PARIS = { lat: 48.8566, lng: 2.3522 };
  const ISTANBUL = { lat: 41.0082, lng: 28.9784 };
  const GOREME = { lat: 38.6431, lng: 34.8289 };
  const KYOTO = { lat: 35.0116, lng: 135.7681 };
  const OSAKA = { lat: 34.6937, lng: 135.5023 };
  const UBUD = { lat: -8.5069, lng: 115.2625 };
  const GILI = { lat: -8.3494, lng: 116.0384 };
  const AGRA = { lat: 27.1767, lng: 78.0081 };
  const JAIPUR = { lat: 26.9124, lng: 75.7873 };
  const ATHENS = { lat: 37.9755, lng: 23.7348 };
  const SANTORINI = { lat: 36.4167, lng: 25.4318 };
  type Known = Parameters<typeof buildTransferActivity>[0]["known"];
  const leg = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, toCity: string, known?: Known) =>
    buildTransferActivity({
      fromCity: "From",
      toCity,
      fromDays: [{ day_number: 1, date: "2026-11-01", activities: [act("there", from)] }],
      toDays: [{ day_number: 2, date: "2026-11-02", activities: [act("here", to)] }],
      currency: "EUR",
      known,
    });

  it("takes the answer's way and its ride, with the time to get to the station or through the airport", () => {
    expect(leg(BRUSSELS, PARIS, "Paris", { mode: "train", minutes: 82 })).toMatchObject({
      transport_mode: "train",
      name: "Train to Paris",
      duration_minutes: 110,
      estimated_cost: { amount: 40 },
    });
    expect(leg(ISTANBUL, GOREME, "Cappadocia", { mode: "flight", minutes: 80 })).toMatchObject({
      transport_mode: "flight",
      name: "Flight to Cappadocia",
      duration_minutes: 230,
      estimated_cost: { amount: 105 },
    });
  });

  it("names a bus and a ferry, and calls a car a transfer", () => {
    expect(leg(HANOI, HA_LONG, "Ha Long Bay", { mode: "bus", minutes: 150 })).toMatchObject({
      transport_mode: "bus",
      name: "Bus to Ha Long Bay",
      duration_minutes: 180,
      estimated_cost: { amount: 14 },
    });
    expect(leg(UBUD, GILI, "Gili Trawangan", { mode: "ferry", minutes: 120 })).toMatchObject({
      transport_mode: "ferry",
      name: "Ferry to Gili Trawangan",
      duration_minutes: 150,
    });
    expect(leg(AGRA, JAIPUR, "Jaipur", { mode: "car", minutes: 240 })).toMatchObject({
      transport_mode: "ground",
      name: "Transfer to Jaipur",
      duration_minutes: 270,
    });
  });

  it("names them in the trip's language, on the card and the ribbon", () => {
    const NAPLES = { lat: 40.8518, lng: 14.2681 };
    const CAPRI = { lat: 40.5509, lng: 14.2429 };
    const named = (language: string, toCity: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: "bus" | "ferry", minutes: number) =>
      buildTransferActivity({
        fromCity: "From",
        toCity,
        fromDays: [{ day_number: 1, date: "2026-11-01", activities: [act("there", from)] }],
        toDays: [{ day_number: 2, date: "2026-11-02", activities: [act("here", to)] }],
        currency: "EUR",
        language,
        known: { mode, minutes },
      }).name;
    const languages = ["en", "it", "es", "pt"];
    expect(languages.map((l) => named(l, "Capri", NAPLES, CAPRI, "ferry", 50))).toEqual(["Ferry to Capri", "Traghetto per Capri", "Ferry a Capri", "Barco para Capri"]);
    expect(languages.map((l) => named(l, "Ha Long Bay", HANOI, HA_LONG, "bus", 150))).toEqual([
      "Bus to Ha Long Bay",
      "Autobus per Ha Long Bay",
      "Autobús a Ha Long Bay",
      "Ônibus para Ha Long Bay",
    ]);
    const HUE = { lat: 16.4637, lng: 107.5909 };
    const merged = mergeCityItineraries(
      [{ city: "Hanoi", nights: 1 }, { city: "Ha Long Bay", nights: 1 }, { city: "Hue", nights: 1 }],
      [cityResult("Hanoi", 1, HANOI), cityResult("Ha Long Bay", 1, HA_LONG), cityResult("Hue", 1, HUE)],
      "2026-11-01",
      { language: "it", hops: [{ mode: "bus", minutes: 150 }, { mode: "flight", minutes: 70 }] }
    );
    expect(buildJourneyStops(merged.days, "it").map((s) => s.transitFromPrev)).toEqual([undefined, "AUTOBUS · 3h", "VOLO · 3h 40m"]);
  });

  it("flies a train or bus of more than six hours between places far apart, as the question itself asks", () => {
    const BANGKOK = { lat: 13.7563, lng: 100.5018 };
    const CHIANG_MAI = { lat: 18.7883, lng: 98.9853 };
    // About 580 km on a straight line: under an hour in the air, the airport around it, the afternoon left.
    for (const answer of [{ mode: "train", minutes: 780 }, { mode: "bus", minutes: 600 }] as Known[]) {
      const card = leg(BANGKOK, CHIANG_MAI, "Chiang Mai", answer);
      expect(card, JSON.stringify(answer)).toMatchObject({ transport_mode: "flight", name: "Flight to Chiang Mai", estimated_cost: { amount: 107 } });
      expect(card.duration_minutes).toBeLessThanOrEqual(210);
    }
    // Six hours or less stays as answered, and a drive always does: a road trip keeps its road.
    expect(leg(BANGKOK, CHIANG_MAI, "Chiang Mai", { mode: "train", minutes: 360 })).toMatchObject({ transport_mode: "train", duration_minutes: 390 });
    expect(leg(BANGKOK, CHIANG_MAI, "Chiang Mai", { mode: "car", minutes: 600 })).toMatchObject({ transport_mode: "ground", duration_minutes: 630 });
    // A long bus between places closer than 400 km stays a bus: mountain roads, no airport.
    const SAPA = { lat: 22.3364, lng: 103.8438 };
    expect(leg(HANOI, SAPA, "Sapa", { mode: "bus", minutes: 420 })).toMatchObject({ transport_mode: "bus", duration_minutes: 450 });
  });

  it("keeps the estimate when the answer can't be right for the line between the two places", () => {
    const estimate = leg(BRUSSELS, PARIS, "Paris");
    for (const wrong of [
      { mode: "train", minutes: 30 }, // faster than any train
      { mode: "train", minutes: 1200 }, // slower than any
      { mode: "bus", minutes: 80 }, // a bus at 200 km/h
      { mode: "flight", minutes: 200 }, // a flight slower than a car
      { mode: "train", minutes: 5 },
      { mode: "train", minutes: 1500 },
      { mode: "rocket", minutes: 60 },
    ]) {
      expect(leg(BRUSSELS, PARIS, "Paris", wrong as Known), JSON.stringify(wrong)).toEqual(estimate);
    }
    expect(leg(UBUD, GILI, "Gili Trawangan", { mode: "ferry", minutes: 30 })).toEqual(leg(UBUD, GILI, "Gili Trawangan"));
    expect(leg(HANOI, HA_LONG, "Ha Long Bay", { mode: "bus", minutes: 1200 })).toEqual(leg(HANOI, HA_LONG, "Ha Long Bay"));
    // No train to an island, and no flight between places this close.
    expect(leg(ATHENS, SANTORINI, "Santorini", { mode: "train", minutes: 300 })).toEqual(leg(ATHENS, SANTORINI, "Santorini"));
    expect(leg(KYOTO, OSAKA, "Osaka", { mode: "flight", minutes: 15 })).toEqual(leg(KYOTO, OSAKA, "Osaka"));
  });

  it("takes the answer as it is when neither city has a pin to check it by, if it is a ride of ten minutes to a day", () => {
    const unpinned = (known?: Known) => buildTransferActivity({ fromCity: "Lima", toCity: "Cusco", fromDays: [], toDays: [], currency: "USD", known });
    expect(unpinned({ mode: "flight", minutes: 80 })).toMatchObject({ transport_mode: "flight", name: "Flight to Cusco", duration_minutes: 230, estimated_cost: { amount: 40 } });
    expect(unpinned({ mode: "flight", minutes: 5 })).toEqual(unpinned());
    expect(unpinned({ mode: "bus", minutes: 2000 })).toEqual(unpinned());
  });

  it("gives each hop of a trip its own answer, and the estimate where there is none", () => {
    const merged = mergeCityItineraries(
      [{ city: "Brussels", nights: 1 }, { city: "Paris", nights: 1 }, { city: "Lisbon", nights: 1 }],
      [cityResult("Brussels", 1, BRUSSELS), cityResult("Paris", 1, PARIS), cityResult("Lisbon", 1, LISBON)],
      "2026-09-01",
      { hops: [{ mode: "train", minutes: 82 }, undefined] }
    );
    expect(merged.days[1].activities[0]).toMatchObject({ name: "Train to Paris", duration_minutes: 110 });
    const estimated = buildTransferActivity({
      fromCity: "Paris",
      toCity: "Lisbon",
      fromDays: cityResult("Paris", 1, PARIS).days,
      toDays: cityResult("Lisbon", 1, LISBON).days,
      currency: "EUR",
    });
    expect(merged.days[2].activities[0]).toMatchObject({ name: "Flight to Lisbon", duration_minutes: estimated.duration_minutes });
  });
});

// A city's plan can put its best-known sight on its first morning, the one the transfer takes: with no gap after
// arriving, the trip would go there and never see it.
describe("a sight the arrival day can't hold", () => {
  const DELHI = { lat: 28.6139, lng: 77.209 };
  const AGRA = { lat: 27.1751, lng: 78.0421 };
  const stop = (name: string, type: string, start_time: string, duration_minutes: number): Activity =>
    ({ ...act(name, AGRA), type, start_time, duration_minutes }) as Activity;
  const agra = (days: Activity[][]): GeneratedItinerary =>
    ({ ...cityResult("Agra", days.length, AGRA), days: days.map((activities, i) => ({ day_number: i + 1, date: `2027-01-${29 + i}`, activities })) }) as GeneratedItinerary;
  const firstDay = () => [
    stop("Taj Mahal", "landmark", "08:00", 180),
    stop("Pinch of Spice", "restaurant", "11:30", 90),
    stop("Agra Fort", "landmark", "13:30", 150),
    stop("Mehtab Bagh", "park", "16:30", 90),
    stop("Esphahan", "restaurant", "19:00", 90),
  ];
  const secondDay = () => [
    stop("Itimad-ud-Daulah", "landmark", "09:00", 120),
    stop("Joney's Place", "restaurant", "11:30", 90),
    stop("Kinari Bazaar", "market", "13:30", 120),
    stop("Akbar's Tomb", "landmark", "16:00", 120),
    stop("Dasaprakash", "restaurant", "19:00", 90),
  ];
  const trip = (agraDays: Activity[][]) =>
    mergeCityItineraries([{ city: "New Delhi", nights: 1 }, { city: "Agra", nights: agraDays.length }], [cityResult("New Delhi", 1, DELHI), agra(agraDays)], "2027-01-28", {
      // Two hours by train: off at 8:30, in Agra by 11:30.
      hops: [{ mode: "train", minutes: 120 }],
    });
  const timed = (day: { activities: Activity[] }) => day.activities.map((a) => `${a.start_time} ${a.name}`);

  it("goes to another day of the city at its own time, the stops after it later", () => {
    const merged = trip([firstDay(), secondDay()]);
    expect(timed(merged.days[1])).toEqual(["08:30 Train to Agra", "11:30 Pinch of Spice", "13:30 Agra Fort", "16:30 Mehtab Bagh", "19:00 Esphahan"]);
    // Lunch keeps its hour: it goes ahead of the tomb that would have pushed it past 13:30.
    expect(timed(merged.days[2])).toEqual([
      "08:00 Taj Mahal",
      "11:30 Joney's Place",
      "13:20 Itimad-ud-Daulah",
      "15:40 Kinari Bazaar",
      "18:00 Akbar's Tomb",
      "20:20 Dasaprakash",
    ]);
    expect(merged.days[2].activities[2].time_slot).toBe("afternoon");
  });

  it("goes to the day with the most room when the city has several", () => {
    const light = [stop("Fatehpur Sikri", "landmark", "10:00", 180)];
    const merged = trip([firstDay(), secondDay(), light]);
    expect(timed(merged.days[3])).toEqual(["08:00 Taj Mahal", "11:20 Fatehpur Sikri"]);
    expect(merged.days[2].activities.map((a) => a.name)).not.toContain("Taj Mahal");
  });

  it("is left out when no other day of the city has room, and a meal is never carried", () => {
    // A city of one day: nowhere else to go.
    expect(trip([firstDay()]).days[1].activities.map((a) => a.name)).not.toContain("Taj Mahal");
    // A breakfast missed to the train stays missed, even one no gap after arriving could hold.
    const withBreakfast = [stop("Sheroes Hangout", "cafe", "08:30", 90), ...firstDay().slice(1)];
    expect(trip([withBreakfast, secondDay()]).days[2].activities.map((a) => a.name)).not.toContain("Sheroes Hangout");
    // A day that would end past ten at night has no room.
    const full = secondDay().map((s) => ({ ...s, duration_minutes: 200 }) as Activity);
    expect(trip([firstDay(), full]).days[2].activities.map((a) => a.name)).not.toContain("Taj Mahal");
  });
});
