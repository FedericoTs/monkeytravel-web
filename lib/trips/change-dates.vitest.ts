/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { inclusiveDays, planDateChange, moveItineraryDates, extraDaysAsk, extraDaysFrom, savedTripOnNewDates } from "./change-dates";
import type { GeneratedItinerary, ItineraryDay } from "@/types";

const day = (n: number, name: string): ItineraryDay =>
  ({
    day_number: n,
    date: `2026-10-${String(16 + n).padStart(2, "0")}`,
    theme: `Theme ${n}`,
    activities: [{ id: `a${n}`, name, type: "attraction", time_slot: "morning", start_time: "09:00", duration_minutes: 60, description: "", location: "", estimated_cost: { amount: 0, currency: "EUR", tier: "free" } }],
  }) as unknown as ItineraryDay;

const trip = [day(1, "Colosseum"), day(2, "Vatican"), day(3, "Trastevere"), day(4, "Borghese"), day(5, "Ostia")];

describe("inclusiveDays", () => {
  it("counts both ends", () => {
    expect(inclusiveDays("2026-10-17", "2026-10-21")).toBe(5);
    expect(inclusiveDays("2026-10-17", "2026-10-17")).toBe(1);
  });
  it("crosses months and a DST change without drifting", () => {
    expect(inclusiveDays("2026-10-30", "2026-11-02")).toBe(4);
    expect(inclusiveDays("2027-03-27", "2027-03-29")).toBe(3);
  });
  it("is null for a date that isn't a real day", () => {
    expect(inclusiveDays("2026-02-30", "2026-03-02")).toBeNull();
    expect(inclusiveDays("", "2026-03-02")).toBeNull();
  });
});

describe("planDateChange", () => {
  it("same length: the plan just moves", () => {
    expect(planDateChange(5, "2026-12-01", "2026-12-05", 14)).toEqual({ kind: "same", length: 5 });
  });
  it("shorter: says which day goes first", () => {
    expect(planDateChange(5, "2026-12-01", "2026-12-03", 14)).toEqual({ kind: "shorter", length: 3, removedFrom: 4 });
  });
  it("longer: says which day is new first", () => {
    expect(planDateChange(5, "2026-12-01", "2026-12-07", 14)).toEqual({ kind: "longer", length: 7, addedFrom: 6 });
  });
  it("refuses an end before the start, and past the wizard's limit", () => {
    expect(planDateChange(5, "2026-12-05", "2026-12-01", 14)).toEqual({ kind: "invalid", reason: "order" });
    expect(planDateChange(5, "2026-12-01", "2026-12-20", 14)).toEqual({ kind: "invalid", reason: "tooLong" });
    expect(planDateChange(5, "2026-12-01", "not-a-date", 14)).toEqual({ kind: "invalid", reason: "dates" });
  });
});

describe("savedTripOnNewDates", () => {
  it("moves the days, or keeps the first ones of a shorter trip", () => {
    expect(savedTripOnNewDates(trip, "2026-12-30", "2027-01-03", 14)?.map((d) => [d.date, d.activities[0].name])).toEqual([
      ["2026-12-30", "Colosseum"],
      ["2026-12-31", "Vatican"],
      ["2027-01-01", "Trastevere"],
      ["2027-01-02", "Borghese"],
      ["2027-01-03", "Ostia"],
    ]);
    expect(savedTripOnNewDates(trip, "2026-12-01", "2026-12-02", 14)?.map((d) => d.activities[0].name)).toEqual(["Colosseum", "Vatican"]);
  });

  // A saved trip has no assistant waiting to plan them: the new days come
  // empty, on their dates, in the city the trip ends in, for the traveller to fill.
  it("adds the new days of a longer trip empty, on their dates", () => {
    const inNaples = [...trip.slice(0, 4), { ...trip[4], city: "Naples" }];
    const longer = savedTripOnNewDates(inNaples, "2026-12-01", "2026-12-07", 14)!;
    expect(longer.map((d) => [d.day_number, d.date, d.activities.length])).toEqual([
      [1, "2026-12-01", 1],
      [2, "2026-12-02", 1],
      [3, "2026-12-03", 1],
      [4, "2026-12-04", 1],
      [5, "2026-12-05", 1],
      [6, "2026-12-06", 0],
      [7, "2026-12-07", 0],
    ]);
    expect(longer[6]).toMatchObject({ city: "Naples" });
    expect(longer[6].theme).toBeUndefined();
  });

  it("is nothing for dates that don't make a trip", () => {
    expect(savedTripOnNewDates(trip, "2026-12-05", "2026-12-01", 14)).toBeNull();
    expect(savedTripOnNewDates(trip, "2026-12-01", "2027-01-30", 14)).toBeNull();
  });
});

describe("moveItineraryDates", () => {
  it("moves every day and keeps the plan", () => {
    const moved = moveItineraryDates(trip, "2026-12-30", 5);
    expect(moved.map((d) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(moved.map((d) => d.activities[0].name)).toEqual(["Colosseum", "Vatican", "Trastevere", "Borghese", "Ostia"]);
    expect(moved[2].activities[0].id).toBe("a3");
  });
  it("shorter keeps the first days", () => {
    const moved = moveItineraryDates(trip, "2026-12-01", 3);
    expect(moved.map((d) => [d.day_number, d.date, d.activities[0].name])).toEqual([
      [1, "2026-12-01", "Colosseum"],
      [2, "2026-12-02", "Vatican"],
      [3, "2026-12-03", "Trastevere"],
    ]);
  });
  it("never invents days (longer is the assistant's job)", () => {
    expect(moveItineraryDates(trip, "2026-12-01", 7)).toHaveLength(5);
  });
  it("does not touch the original", () => {
    moveItineraryDates(trip, "2026-12-01", 2);
    expect(trip[0].date).toBe("2026-10-17");
    expect(trip).toHaveLength(5);
  });
});

describe("extraDaysAsk", () => {
  const itinerary = {
    destination: { name: "Lisbon", country: "Portugal" },
    days: [day(1, "Belém"), day(2, "Alfama")],
    language: "pt",
  } as unknown as GeneratedItinerary;
  const moved = moveItineraryDates(itinerary.days, "2027-05-10", 2);
  const ask = (length: number, over: Partial<Parameters<typeof extraDaysAsk>[0]> = {}) =>
    extraDaysAsk({ itinerary, moved, start: "2027-05-10", current: 2, length, tripTitle: "Lisbon", locale: "en", ...over });

  it("asks for the new days only, with the plan as it stands on the new dates", () => {
    expect(ask(4)).toEqual({
      message:
        "Add 2 more days at the end of the trip (Days 3 to 4), planned like the other days, and set trip_length to 4. Leave the existing days as they are.",
      destination: "Lisbon, Portugal",
      tripTitle: "Lisbon",
      days: moved,
      startDate: "2027-05-10",
      endDate: "2027-05-11",
      locale: "pt",
      history: [],
    });
  });

  it("names a single new day as one", () => {
    expect(ask(3).message).toBe(
      "Add 1 more day at the end of the trip (Day 3), planned like the other days, and set trip_length to 3. Leave the existing days as they are."
    );
  });

  it("speaks the page's language for a plan without its own", () => {
    expect(ask(3, { itinerary: { ...itinerary, language: undefined } as GeneratedItinerary }).locale).toBe("en");
  });
});

describe("extraDaysFrom", () => {
  const edit = (n: number) => ({ day_number: n, activities: [] });

  it("keeps only the days after the plan's, up to the length the reply reached", () => {
    expect(extraDaysFrom({ data: { edits: [edit(2), edit(3), edit(4), edit(5)], tripLength: 4 } }, 2, 5)).toEqual({
      planned: 4,
      newDays: [edit(3), edit(4)],
    });
  });

  it("reads a reply with or without its data wrapper, never past the trip's length", () => {
    expect(extraDaysFrom({ edits: [edit(3)], tripLength: 9 }, 2, 3)).toEqual({ planned: 3, newDays: [edit(3)] });
  });

  it("finds nothing in a reply without days or a length", () => {
    expect(extraDaysFrom({ data: { edits: "none", tripLength: "4" } }, 2, 4)).toEqual({ planned: 0, newDays: [] });
    expect(extraDaysFrom({ data: { edits: [null, edit(3)] } }, 2, 4)).toEqual({ planned: 0, newDays: [] });
    expect(extraDaysFrom(null, 2, 4)).toEqual({ planned: 0, newDays: [] });
  });
});
