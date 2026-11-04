import { describe, expect, it } from "vitest";
import { isTripVibe, TRIP_VIBES, type TripCreationParams } from "@/types";
import { validateTripParams } from "./request-validation";

/**
 * The vibes are declared once, in TRIP_VIBES: the server, kept plans and the
 * routes that read a trip's tags all go by it.
 */
describe("the trip's vibes", () => {
  it("are told apart from anything else", () => {
    for (const vibe of TRIP_VIBES) expect(isTripVibe(vibe), vibe).toBe(true);
    for (const other of ["Adventure", "sleepy", "", " foodie", 3, null, undefined, ["foodie"]]) {
      expect(isTripVibe(other), String(other)).toBe(false);
    }
  });

  it("are each one the server takes, and nothing else is", () => {
    const request = (vibes: string[]) =>
      validateTripParams({
        destination: "Lisbon",
        startDate: "2099-08-11",
        endDate: "2099-08-15",
        budgetTier: "balanced",
        pace: "moderate",
        vibes,
        interests: [],
      } as TripCreationParams);
    for (const vibe of TRIP_VIBES) expect(request([vibe]), vibe).toEqual({ valid: true });
    expect(request(["sleepy"])).toEqual({ valid: false, error: "Invalid vibe: sleepy" });
  });
});
