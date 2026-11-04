import { describe, expect, it } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { applyPlaceChanges, placesToEatCheckDue, type PlaceChange } from "./kept-trip";

/**
 * A kept trip's places to eat are looked up once, on its owner's first open,
 * and the trip page makes the server's changes to its own copy.
 */

const TODAY = "2026-11-04";

describe("placesToEatCheckDue", () => {
  it("is due for a diet trip not checked and not over", () => {
    expect(placesToEatCheckDue({ endDate: "2026-11-20", meta: {} }, ["vegan"], TODAY)).toBe(true);
    expect(placesToEatCheckDue({ endDate: TODAY, meta: undefined }, ["vegan"], TODAY)).toBe(true);
    expect(placesToEatCheckDue({ endDate: null, meta: {} }, ["halal"], TODAY)).toBe(true);
  });

  it("is not due without a diet, once checked, or for a trip that is over", () => {
    expect(placesToEatCheckDue({ endDate: "2026-11-20", meta: {} }, [], TODAY)).toBe(false);
    expect(placesToEatCheckDue({ endDate: "2026-11-20", meta: { places_to_eat_checked_at: "2026-11-04T10:00:00.000Z" } }, ["vegan"], TODAY)).toBe(false);
    expect(placesToEatCheckDue({ endDate: "2026-11-03", meta: {} }, ["vegan"], TODAY)).toBe(false);
  });
});

const meal = (name: string, more: Partial<Activity> = {}) => ({ name, type: "restaurant", ...more }) as Activity;
const day = (day_number: number, ...activities: Activity[]) => ({ day_number, activities }) as unknown as ItineraryDay;
const names = (it: ItineraryDay[]) => it.map((d) => d.activities.map((a) => a.name));

describe("applyPlaceChanges", () => {
  const plantBase = meal("Plant Base", { id: "act_new" });
  const changes: PlaceChange[] = [
    { day: 1, id: "a1", name: "Dinner at Arkhe", to: plantBase },
    { day: 2, name: "Lunch at Vegana Burgers", to: null, unverified: true },
    { day: 2, id: "a3", name: "Foodprintz", to: null },
  ];

  it("puts the new place in, marks the one Maps doesn't have, and leaves the closed one out", () => {
    const it = [
      day(1, meal("Torre de Belém", { id: "a0", type: "landmark" }), meal("Dinner at Arkhe", { id: "a1" })),
      day(2, meal("Lunch at Vegana Burgers", { id: "a2" }), meal("Foodprintz", { id: "a3" })),
    ];

    const next = applyPlaceChanges(it, changes);

    expect(names(next)).toEqual([["Torre de Belém", "Plant Base"], ["Lunch at Vegana Burgers"]]);
    expect(next[0].activities[1]).toBe(plantBase);
    expect(next[1].activities[0]).toEqual({ ...it[1].activities[0], unverified: true });
    expect(it[1].activities[0].unverified).toBeUndefined();
  });

  it("changes nothing where the place is no longer as it was: renamed, replaced under its id, or moved to another day", () => {
    const it = [
      day(1, meal("Dinner at Arkhe (closed Mondays)", { id: "a1" })),
      day(2, meal("Lunch at Vegana Burgers", { id: "a2" }), meal("Dinner at Arkhe", { id: "a1" })),
      day(3, meal("Foodprintz", { id: "a3" })),
    ];
    const swapped = [day(1, meal("Dinner at Arkhe", { id: "other" }))];

    expect(names(applyPlaceChanges(it, changes))).toEqual([
      ["Dinner at Arkhe (closed Mondays)"],
      ["Lunch at Vegana Burgers", "Dinner at Arkhe"],
      ["Foodprintz"],
    ]);
    expect(names(applyPlaceChanges(swapped, changes))).toEqual([["Dinner at Arkhe"]]);
  });

  it("makes each change once, for the first place by that name", () => {
    const twice = [day(1, meal("Dinner at Arkhe"), meal("Dinner at Arkhe"))];
    const next = applyPlaceChanges(twice, [{ day: 1, name: "Dinner at Arkhe", to: plantBase }]);
    expect(names(next)).toEqual([["Plant Base", "Dinner at Arkhe"]]);
  });

  it("gives back the same itinerary when there is nothing to change", () => {
    const it = [day(1, meal("Dinner at Arkhe"))];
    expect(applyPlaceChanges(it, [])).toBe(it);
    expect(applyPlaceChanges(it, [{ day: 2, name: "Dinner at Arkhe", to: null }])[0]).toBe(it[0]);
  });
});
