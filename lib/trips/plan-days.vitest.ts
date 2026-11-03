/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { GeneratedItinerary, ItineraryDay } from "@/types";
import { withDays } from "./plan-days";

const day = (n: number, ...costs: (number | undefined)[]) =>
  ({
    day_number: n,
    activities: costs.map((amount, i) => ({ name: `a${n}-${i}`, ...(amount === undefined ? {} : { estimated_cost: { amount } }) })),
  }) as unknown as ItineraryDay;
const plan = (total: number | undefined, days: ItineraryDay[]) =>
  ({
    destination: { name: "Lisbon" },
    days,
    ...(total === undefined ? {} : { trip_summary: { total_estimated_cost: total, currency: "EUR" } }),
  }) as unknown as GeneratedItinerary;

describe("withDays", () => {
  it("moves the total by what the activities cost, keeping the rest of it", () => {
    const before = plan(900, [day(1, 100, 40), day(2, 200)]);
    const after = withDays(before, [day(1, 100, 40), day(2, 200), day(3, 100, 40)]);
    expect(after.trip_summary).toEqual({ total_estimated_cost: 1040, currency: "EUR" });
    expect(after.days).toHaveLength(3);
    expect(after.destination).toBe(before.destination);
  });

  it("rounds, and never goes below zero", () => {
    expect(withDays(plan(100, [day(1, 10)]), [day(1, 10.6)]).trip_summary.total_estimated_cost).toBe(101);
    expect(withDays(plan(50, [day(1, 400)]), [day(1)]).trip_summary.total_estimated_cost).toBe(0);
  });

  it("counts days and activities without a cost as nothing, and a plan without a total as zero", () => {
    const missing = { day_number: 2 } as unknown as ItineraryDay;
    expect(withDays(plan(300, [day(1, 50), missing]), [day(1, 50, undefined)]).trip_summary.total_estimated_cost).toBe(300);
    expect(withDays(plan(undefined, [day(1, 50)]), [day(1, 80)]).trip_summary.total_estimated_cost).toBe(30);
  });

  it("leaves the plan it is given as it was", () => {
    const before = plan(900, [day(1, 100)]);
    const snapshot = structuredClone(before);
    withDays(before, [day(1, 300)]);
    expect(before).toEqual(snapshot);
  });
});
