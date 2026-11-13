import { describe, expect, it } from "vitest";
import { cachePolicy, mayCachePlan, servableCachedPlan, type CachePolicy } from "./cache-policy";
import type { GeneratedItinerary, TripCreationParams } from "@/types";

const plan = (days: number) => ({ days: Array.from({ length: days }, (_, i) => ({ day_number: i + 1 })) }) as unknown as GeneratedItinerary;
const rules = (over: Partial<CachePolicy> = {}): CachePolicy => ({ tailored: false, fresh: false, totalDays: 3, ...over });
const trip = (over: Partial<TripCreationParams> = {}) =>
  ({ destination: "Lisbon, Portugal", startDate: "2026-11-01", endDate: "2026-11-03", vibes: [], budgetTier: "balanced", pace: "moderate", ...over }) as TripCreationParams;

describe("cachePolicy", () => {
  it("counts a trip with must-dos or a diet as tailored", () => {
    expect(cachePolicy(trip(), false, 3).tailored).toBe(false);
    expect(cachePolicy(trip({ mustDos: ["Belém Tower"] }), false, 3).tailored).toBe(true);
    expect(cachePolicy(trip({ profilePreferences: { dietaryPreferences: ["vegan"] } }), false, 3).tailored).toBe(true);
    expect(cachePolicy(trip({ mustDos: [], profilePreferences: { dietaryPreferences: [] } }), false, 3).tailored).toBe(false);
  });

  it("counts a plan shaped by who's coming as tailored", () => {
    expect(cachePolicy(trip({ tripIntent: "solo" }), false, 3).tailored).toBe(true);
    expect(cachePolicy(trip({ tripIntent: "group" }), false, 3).tailored).toBe(true);
  });

  it("counts a plan around where they're staying as tailored", () => {
    expect(cachePolicy(trip({ stay: { name: "Memmo Alfama" } }), false, 3).tailored).toBe(true);
  });

  it("carries the fresh flag and the trip's length", () => {
    expect(cachePolicy(trip(), true, 5)).toEqual({ tailored: false, fresh: true, totalDays: 5 });
  });
});

describe("servableCachedPlan", () => {
  it("serves a cached plan at least as long as the trip", () => {
    expect(servableCachedPlan(plan(3), rules())).toEqual(plan(3));
    expect(servableCachedPlan(plan(7), rules())).toEqual(plan(7));
  });

  it("never serves a shorter one, or nothing", () => {
    expect(servableCachedPlan(plan(2), rules())).toBeNull();
    expect(servableCachedPlan(null, rules())).toBeNull();
  });

  it("never serves a tailored trip or a fresh redo", () => {
    expect(servableCachedPlan(plan(7), rules({ tailored: true }))).toBeNull();
    expect(servableCachedPlan(plan(7), rules({ fresh: true }))).toBeNull();
  });
});

describe("mayCachePlan", () => {
  it("adds a new plan to the shared pool, over whatever is there", () => {
    expect(mayCachePlan(plan(3), null, rules())).toBe(true);
    expect(mayCachePlan(plan(3), plan(7), rules())).toBe(true);
  });

  it("never adds a tailored plan", () => {
    expect(mayCachePlan(plan(3), null, rules({ tailored: true }))).toBe(false);
  });

  it("lets a fresh redo replace a shorter or equal entry, never a longer one", () => {
    expect(mayCachePlan(plan(3), null, rules({ fresh: true }))).toBe(true);
    expect(mayCachePlan(plan(3), plan(2), rules({ fresh: true }))).toBe(true);
    expect(mayCachePlan(plan(3), plan(3), rules({ fresh: true }))).toBe(true);
    expect(mayCachePlan(plan(3), plan(7), rules({ fresh: true }))).toBe(false);
  });
});
