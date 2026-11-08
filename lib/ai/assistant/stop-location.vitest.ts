import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { knownPoints, stopLocation } from "./stop-location";

// A Kyoto trip: one stop with a real location, one on the coordinate
// fallback's placeholder point, one with none.
const KYOTO = [
  {
    day_number: 1,
    date: "2026-12-21",
    activities: [
      { name: "Fushimi Inari-taisha", coordinates: { lat: 34.967146, lng: 135.772675 } },
      { name: "Kiyomizu-dera", coordinates: { lat: 48.012476, lng: 10.001981 } },
      { name: "Gion" },
    ],
  },
] as unknown as ItineraryDay[];

describe("knownPoints", () => {
  it("lists the trip's stops that have a real location", () => {
    expect(knownPoints(KYOTO)).toEqual([{ lat: 34.967146, lng: 135.772675 }]);
  });
});

describe("stopLocation", () => {
  const known = knownPoints(KYOTO);

  it("keeps a real point within reach of the trip, to 6 decimals", () => {
    expect(stopLocation({ lat: 34.99485612, lng: 135.78504988 }, known)).toEqual({ lat: 34.994856, lng: 135.78505 });
    // A day trip to Nara, given as text.
    expect(stopLocation({ lat: "34.6851", lng: "135.843" }, known)).toEqual({ lat: 34.6851, lng: 135.843 });
  });

  it("drops a point far from every place the trip knows", () => {
    // The Eiffel Tower, in a Kyoto trip.
    expect(stopLocation({ lat: 48.85837, lng: 2.294481 }, known)).toBeUndefined();
  });

  it("drops what isn't a real point, whatever the trip knows", () => {
    for (const raw of [undefined, null, {}, { lat: 0, lng: 0 }, { lat: 48.003, lng: 10.004 }, { lat: "near Gion", lng: 135.77 }, { lat: 95, lng: 135 }]) {
      expect(stopLocation(raw, known)).toBeUndefined();
      expect(stopLocation(raw, [])).toBeUndefined();
    }
  });

  it("keeps any real point when the trip knows no place to compare", () => {
    expect(stopLocation({ lat: 34.99, lng: 135.78 }, [])).toEqual({ lat: 34.99, lng: 135.78 });
  });
});
