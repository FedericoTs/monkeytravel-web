import { describe, expect, it } from "vitest";
import {
  DAILY_GAMEPLAY_AWARD_CAP,
  FIRST_TRIP_REFERENCE,
  activityReferenceFor,
  itineraryActivityCount,
  storedAwardReference,
} from "./award-reference";

/**
 * Before 2026-09-23 /api/bananas/award credited any new reference string:
 * first_trip_bonus with referenceId "a", "b", "c"... was 25 bananas each.
 * These pin the references each award accepts and what it is stored under.
 * Activity completions are capped per trip by the route (one credit per
 * activity in the itinerary) rather than matched to stored ids, because
 * many itineraries are saved without ids and the browser mints new ones.
 */

const TRIP = "11111111-1111-4111-8111-111111111111";

describe("itineraryActivityCount", () => {
  it("counts every activity, with or without an id, and skips junk", () => {
    const itinerary = [
      { activities: [{ id: "act-1" }, { name: "no id" }] },
      { activities: [null, { id: "act-3" }] },
      { activities: null },
      null,
    ];
    expect(itineraryActivityCount(itinerary)).toBe(3);
    expect(itineraryActivityCount(null)).toBe(0);
    expect(itineraryActivityCount({ not: "an array" })).toBe(0);
  });
});

describe("storedAwardReference", () => {
  it("activity_completion: any activity reference, stored per trip", () => {
    expect(storedAwardReference("activity_completion", TRIP, "act_random123")).toBe(
      activityReferenceFor(TRIP, "act_random123")
    );
    expect(storedAwardReference("activity_completion", TRIP, "")).toBeNull();
    expect(storedAwardReference("activity_completion", TRIP, "x".repeat(129))).toBeNull();
  });

  it("achievement_bonus: <tripId>:<known achievement> only", () => {
    expect(storedAwardReference("achievement_bonus", TRIP, `${TRIP}:first_steps`)).toBe(`${TRIP}:first_steps`);
    expect(storedAwardReference("achievement_bonus", TRIP, `${TRIP}:made_up`)).toBeNull();
    expect(storedAwardReference("achievement_bonus", TRIP, "other-trip:first_steps")).toBeNull();
    expect(storedAwardReference("achievement_bonus", TRIP, `${TRIP}:toString`)).toBeNull();
  });

  it("trip_complete: the trip id only", () => {
    expect(storedAwardReference("trip_complete", TRIP, TRIP)).toBe(TRIP);
    expect(storedAwardReference("trip_complete", TRIP, "anything-else")).toBeNull();
  });

  it("first_trip_bonus: the one constant, so it can only ever be earned once", () => {
    expect(storedAwardReference("first_trip_bonus", TRIP, FIRST_TRIP_REFERENCE)).toBe(FIRST_TRIP_REFERENCE);
    expect(storedAwardReference("first_trip_bonus", TRIP, TRIP)).toBeNull();
    expect(storedAwardReference("first_trip_bonus", TRIP, "first_trip_2")).toBeNull();
  });

  it("the daily cap leaves room for a full real day", () => {
    // 30 activities + 10 achievements x 5 + trip complete + first trip.
    expect(30 + 50 + 10 + 25).toBeLessThanOrEqual(DAILY_GAMEPLAY_AWARD_CAP);
  });
});
