import { describe, it, expect } from "vitest";
import { deriveRefineSuggestions } from "./refine-suggestions";
import type { Activity, ItineraryDay } from "@/types";

function act(name: string, type = "attraction", locked = false): Activity {
  return {
    name,
    type: type as Activity["type"],
    description: "",
    location: "",
    time_slot: "morning",
    start_time: "10:00",
    duration_minutes: 60,
    estimated_cost: { amount: 0, currency: "EUR", tier: "free" },
    tips: [],
    booking_required: false,
    ...(locked ? { locked: true } : {}),
  } as Activity;
}

function day(n: number, activities: Activity[]): ItineraryDay {
  return { day_number: n, date: `2026-09-0${n}`, activities };
}

describe("deriveRefineSuggestions", () => {
  it("flags the busiest day when it is genuinely over-full", () => {
    const s = deriveRefineSuggestions([
      day(1, [act("A"), act("B")]),
      day(2, [act("A"), act("B"), act("C"), act("D"), act("E"), act("F")]),
    ]);
    const busy = s.find((x) => x.key === "busyDay");
    expect(busy).toBeDefined();
    expect(busy!.params).toEqual({ day: 2, count: 6 });
    expect(busy!.prompt).toContain("Day 2");
  });

  it("does NOT invent a busy day on a normally-paced trip", () => {
    const s = deriveRefineSuggestions([
      day(1, [act("A"), act("B"), act("Dinner", "restaurant")]),
      day(2, [act("C"), act("D"), act("Lunch", "restaurant")]),
    ]);
    expect(s.some((x) => x.key === "busyDay")).toBe(false);
  });

  it("spots a day with nowhere to eat", () => {
    const s = deriveRefineSuggestions([
      day(1, [act("Museum"), act("Park"), act("Dinner at Trattoria")]),
      day(2, [act("Castle"), act("Gallery"), act("Viewpoint")]),
    ]);
    const food = s.find((x) => x.key === "noFood");
    expect(food?.params.day).toBe(2);
  });

  it("recognises food by type OR by name", () => {
    const byType = deriveRefineSuggestions([day(1, [act("Somewhere", "restaurant")])]);
    expect(byType.some((x) => x.key === "noFood")).toBe(false);
    const byName = deriveRefineSuggestions([day(1, [act("Lunch at the market")])]);
    expect(byName.some((x) => x.key === "noFood")).toBe(false);
  });

  it("flags a suspiciously empty day", () => {
    const s = deriveRefineSuggestions([
      day(1, [act("A"), act("B"), act("Dinner", "restaurant")]),
      day(2, [act("Just one thing")]),
    ]);
    expect(s.find((x) => x.key === "lightDay")?.params.day).toBe(2);
  });

  it("never suggests changing a fully-anchored day — that's the traveller's own", () => {
    const s = deriveRefineSuggestions([
      day(1, [act("Wedding", "attraction", true)]),
      day(2, [act("A"), act("B"), act("Dinner", "restaurant")]),
    ]);
    // Day 1 is one activity and has no food, but it's anchored: never named.
    expect(s.every((x) => x.params.day !== 1)).toBe(true);
  });

  it("returns [] rather than inventing a problem, so the caller can fall back", () => {
    expect(deriveRefineSuggestions([])).toEqual([]);
    expect(deriveRefineSuggestions(null)).toEqual([]);
    expect(deriveRefineSuggestions(undefined)).toEqual([]);
    expect(deriveRefineSuggestions([day(1, [act("Wedding", "attraction", true)])])).toEqual([]);
  });

  it("caps the list and survives malformed days", () => {
    const s = deriveRefineSuggestions([
      day(1, [act("A"), act("B"), act("C"), act("D"), act("E"), act("F"), act("G")]),
      day(2, [act("Solo")]),
      { day_number: 3, date: "2026-09-03" } as ItineraryDay,
    ], 2);
    expect(s.length).toBeLessThanOrEqual(2);
    expect(() => deriveRefineSuggestions([{ day_number: 9 } as ItineraryDay])).not.toThrow();
  });
});
