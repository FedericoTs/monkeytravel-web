import { describe, expect, it } from "vitest";
import { FIRST_TRIP_REFERENCE, isValidAwardReference, itineraryActivityIds } from "./award-reference";

/**
 * Before 2026-09-23 /api/bananas/award credited any new reference string:
 * first_trip_bonus with referenceId "a", "b", "c"... was 25 bananas each.
 * These pin the only references each award accepts — the ones
 * lib/hooks/useGamification.ts sends.
 */

const TRIP = "11111111-1111-4111-8111-111111111111";
const itinerary = [
  { activities: [{ id: "act-1" }, { id: "act-2" }] },
  { activities: [{ id: "act-3" }, null, { name: "no id" }] },
  { activities: null },
];

describe("itineraryActivityIds", () => {
  it("collects every activity id and skips junk", () => {
    expect([...itineraryActivityIds(itinerary)].sort()).toEqual(["act-1", "act-2", "act-3"]);
    expect(itineraryActivityIds(null).size).toBe(0);
    expect(itineraryActivityIds({ not: "an array" }).size).toBe(0);
  });
});

describe("isValidAwardReference", () => {
  it("activity_completion: only an activity in this trip", () => {
    expect(isValidAwardReference("activity_completion", TRIP, "act-2", itinerary)).toBe(true);
    expect(isValidAwardReference("activity_completion", TRIP, "act-999", itinerary)).toBe(false);
    expect(isValidAwardReference("activity_completion", TRIP, TRIP, itinerary)).toBe(false);
  });

  it("achievement_bonus: <tripId>:<known achievement> only", () => {
    expect(isValidAwardReference("achievement_bonus", TRIP, `${TRIP}:first_steps`, itinerary)).toBe(true);
    expect(isValidAwardReference("achievement_bonus", TRIP, `${TRIP}:made_up`, itinerary)).toBe(false);
    expect(isValidAwardReference("achievement_bonus", TRIP, "other-trip:first_steps", itinerary)).toBe(false);
    expect(isValidAwardReference("achievement_bonus", TRIP, `${TRIP}:toString`, itinerary)).toBe(false);
  });

  it("trip_complete: the trip id only", () => {
    expect(isValidAwardReference("trip_complete", TRIP, TRIP, itinerary)).toBe(true);
    expect(isValidAwardReference("trip_complete", TRIP, "anything-else", itinerary)).toBe(false);
  });

  it("first_trip_bonus: the one constant, so it can only ever be earned once", () => {
    expect(isValidAwardReference("first_trip_bonus", TRIP, FIRST_TRIP_REFERENCE, itinerary)).toBe(true);
    expect(isValidAwardReference("first_trip_bonus", TRIP, TRIP, itinerary)).toBe(false);
    expect(isValidAwardReference("first_trip_bonus", TRIP, "first_trip_2", itinerary)).toBe(false);
  });
});
