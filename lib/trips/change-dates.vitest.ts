/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { inclusiveDays, planDateChange, moveItineraryDates } from "./change-dates";
import type { ItineraryDay } from "@/types";

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
