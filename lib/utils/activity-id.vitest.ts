import { describe, it, expect } from "vitest";
import type { ItineraryDay, Activity } from "@/types";
import { moveActivityToDay } from "./activity-id";

const act = (id: string, start: string): Activity =>
  ({ id, name: id, type: "attraction", start_time: start, duration_minutes: 60 }) as unknown as Activity;

const day = (day_number: number, ...activities: Activity[]): ItineraryDay =>
  ({ day_number, date: `2026-10-0${day_number}`, activities }) as ItineraryDay;

const base = (): ItineraryDay[] => [
  day(1, act("a1", "09:00"), act("a2", "12:00"), act("a3", "18:00")),
  day(2, act("b1", "10:00"), act("b2", "15:00")),
  day(3),
];

const ids = (it: ItineraryDay[]) => it.map((d) => d.activities.map((a) => a.id));

describe("moveActivityToDay", () => {
  it("appends to the target day by default (legacy behaviour)", () => {
    expect(ids(moveActivityToDay(base(), "a1", 1))).toEqual([["a2", "a3"], ["b1", "b2", "a1"], []]);
  });

  it("inserts at an explicit index, clamped to the list", () => {
    expect(ids(moveActivityToDay(base(), "a1", 1, 0))[1]).toEqual(["a1", "b1", "b2"]);
    expect(ids(moveActivityToDay(base(), "a1", 1, 1))[1]).toEqual(["b1", "a1", "b2"]);
    expect(ids(moveActivityToDay(base(), "a1", 1, 99))[1]).toEqual(["b1", "b2", "a1"]);
  });

  it("'auto' keeps the activity in the same part of the day by start time", () => {
    // 12:00 lands between 10:00 and 15:00
    expect(ids(moveActivityToDay(base(), "a2", 1, "auto"))[1]).toEqual(["b1", "a2", "b2"]);
    // 09:00 lands before 10:00
    expect(ids(moveActivityToDay(base(), "a1", 1, "auto"))[1]).toEqual(["a1", "b1", "b2"]);
    // 18:00 lands last
    expect(ids(moveActivityToDay(base(), "a3", 1, "auto"))[1]).toEqual(["b1", "b2", "a3"]);
    // empty day: only slot
    expect(ids(moveActivityToDay(base(), "a2", 2, "auto"))[2]).toEqual(["a2"]);
  });

  it("is a no-op for the same day, an unknown activity, or an invalid day", () => {
    const it = base();
    expect(moveActivityToDay(it, "a1", 0)).toBe(it);
    expect(moveActivityToDay(it, "ghost", 1)).toBe(it);
    expect(moveActivityToDay(it, "a1", 7)).toBe(it);
    expect(moveActivityToDay(it, "a1", -1)).toBe(it);
  });

  it("does not mutate its input", () => {
    const it = base();
    const snapshot = JSON.stringify(it);
    moveActivityToDay(it, "a1", 2, "auto");
    expect(JSON.stringify(it)).toBe(snapshot);
  });
});
