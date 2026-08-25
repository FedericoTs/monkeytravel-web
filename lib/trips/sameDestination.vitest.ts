import { describe, it, expect } from "vitest";
import { isSameDestination } from "./sameDestination";

/**
 * Guards the decision the wizard makes before re-generating: update the trip
 * auto-save already persisted, or insert a new one.
 *
 * Getting this wrong is asymmetric. A false negative leaves a duplicate trip
 * in the user's list — annoying, recoverable, and exactly the bug measured on
 * 2026-08-25 (31 pairs across 24 users). A false POSITIVE overwrites a saved
 * trip with a different city — silent data loss. So every ambiguous case here
 * must resolve to `false`.
 */

describe("isSameDestination", () => {
  it("matches the itinerary's bare city against the form's city, country", () => {
    // The real shapes: the model returns "Dubrovnik", the autocomplete stored
    // "Dubrovnik, Croatia". This pair is the reported bug.
    expect(isSameDestination("Dubrovnik", "Dubrovnik, Croatia")).toBe(true);
    expect(isSameDestination("Prague", "Prague, Czech Republic")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isSameDestination("  dubrovnik ", "DUBROVNIK, Croatia")).toBe(true);
  });

  it("ignores accent and punctuation drift between the two sources", () => {
    expect(isSameDestination("Malaga", "Málaga, Spain")).toBe(true);
    expect(isSameDestination("Málaga", "Malaga, Spain")).toBe(true);
    expect(isSameDestination("St. Ives", "St Ives, United Kingdom")).toBe(true);
  });

  it("treats a different city as a different trip", () => {
    // The data-loss case: go back, plan somewhere else, generate. Must insert.
    expect(isSameDestination("Dubrovnik", "Tokyo, Japan")).toBe(false);
    expect(isSameDestination("Prague", "Vienna, Austria")).toBe(false);
  });

  it("does not treat a prefix as a match", () => {
    // "San" must not match "San Francisco", and Prague must not match Prague's
    // neighbours by string containment.
    expect(isSameDestination("San", "San Francisco, United States")).toBe(false);
    expect(isSameDestination("York", "New York, United States")).toBe(false);
  });

  it("resolves every empty or missing input to false, never true", () => {
    // Cannot establish sameness -> insert, which is the non-destructive side.
    expect(isSameDestination(null, "Dubrovnik, Croatia")).toBe(false);
    expect(isSameDestination("Dubrovnik", null)).toBe(false);
    expect(isSameDestination(undefined, undefined)).toBe(false);
    expect(isSameDestination("", "")).toBe(false);
    expect(isSameDestination("   ", "Dubrovnik")).toBe(false);
    expect(isSameDestination(",Croatia", "Dubrovnik, Croatia")).toBe(false);
  });

  it("compares only the first segment of a multi-city form value", () => {
    // Multi-city writes "Prague, Brussels, Ghent" into the field. The saved
    // itinerary for that trip is named for its first city, so it matches; a
    // multi-city run starting elsewhere does not.
    expect(isSameDestination("Prague", "Prague, Brussels, Ghent")).toBe(true);
    expect(isSameDestination("Berlin", "Prague, Brussels, Ghent")).toBe(false);
  });
});
