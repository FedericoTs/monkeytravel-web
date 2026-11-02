// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { sharedViewTrip } from "./view-trip";

const itinerary = [{ day_number: 1, date: "2026-10-09", activities: [] }] as unknown as ItineraryDay[];
const distances = [{ dayNumber: 1, segments: [], totalDistanceMeters: 0, totalDurationSeconds: 0 }];

describe("sharedViewTrip", () => {
  it("is the stored trip as the view shows it", () => {
    const row = {
      id: "trip-1",
      title: "Lisbon Trip",
      description: "Trams and tiles",
      status: "planning",
      start_date: "2026-10-09",
      end_date: "2026-10-11",
      tags: ["food"],
      budget: { total: 500, currency: "EUR" },
      shared_at: "2026-10-01T00:00:00Z",
      trip_meta: { destination: "Lisbon", packing_suggestions: ["Hat"], travel_distances: distances, travel_distances_hash: "h1" },
      packing_list: [],
      share_token: "never-shown",
    };
    expect(sharedViewTrip(row, itinerary)).toEqual({
      id: "trip-1",
      title: "Lisbon Trip",
      description: "Trams and tiles",
      status: "planning",
      startDate: "2026-10-09",
      endDate: "2026-10-11",
      tags: ["food"],
      budget: { total: 500, currency: "EUR" },
      itinerary,
      sharedAt: "2026-10-01T00:00:00Z",
      meta: row.trip_meta,
      // The stored list is empty, so the plan's suggestions show.
      packingList: ["Hat"],
      cachedTravelDistances: distances,
      cachedTravelHash: "h1",
    });
  });

  it("reads a trip with no meta and no budget", () => {
    const trip = sharedViewTrip(
      { id: "t", title: "T", status: "planning", start_date: "2026-10-09", end_date: "2026-10-09", budget: null, trip_meta: null, packing_list: ["Passport"] },
      itinerary
    );
    expect(trip.meta).toEqual({});
    expect(trip.budget).toBeNull();
    expect(trip.packingList).toEqual(["Passport"]);
    expect(trip.cachedTravelDistances).toBeUndefined();
  });
});
