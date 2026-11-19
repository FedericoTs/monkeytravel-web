import { describe, expect, it } from "vitest";
import { plannedMinutes, withStopAt, type TimedStop } from "./day-room";

const stop = (name: string, type: string, start_time: string, duration_minutes: number): TimedStop => ({
  name,
  type,
  start_time,
  duration_minutes,
});
const timed = (day: { activities?: TimedStop[] } | null) => (day?.activities ?? []).map((a) => `${a.start_time} ${a.name}`);

// A morning sight of three hours put into a full day.
const MORNING_SIGHT = stop("Taj Mahal", "landmark", "08:00", 180);

describe("withStopAt", () => {
  it("puts the stop in at its own time and moves the stops after it later, a short walk apart", () => {
    const day = { activities: [stop("Fort", "landmark", "09:00", 120), stop("Garden", "park", "16:00", 60)] };
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Fort", "16:00 Garden"]);
    expect(withStopAt(day, MORNING_SIGHT)?.activities?.[1].time_slot).toBe("morning");
  });

  it("brings a meal the move would push well past its hour ahead of the sight pushing it", () => {
    const day = {
      activities: [
        stop("Tomb", "landmark", "09:00", 120),
        stop("Lunch place", "restaurant", "11:30", 90),
        stop("Bazaar", "market", "13:30", 120),
        stop("Second tomb", "landmark", "16:00", 120),
        stop("Dinner place", "restaurant", "19:00", 90),
      ],
    };
    // Kept in order, lunch would start at 13:40, over two hours late.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual([
      "08:00 Taj Mahal",
      "11:30 Lunch place",
      "13:20 Tomb",
      "15:40 Bazaar",
      "18:00 Second tomb",
      "20:20 Dinner place",
    ]);
  });

  it("goes ahead of as few stops as it takes", () => {
    const day = {
      activities: [
        stop("Tomb", "landmark", "09:00", 60),
        stop("Garden", "park", "10:30", 60),
        stop("Lunch place", "restaurant", "12:00", 60),
      ],
    };
    // In order: tomb 11:20, garden 12:40, lunch 14:00 (two hours late). One place ahead is enough.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Tomb", "12:40 Lunch place", "14:00 Garden"]);
  });

  it("goes ahead of two stops when one isn't enough", () => {
    const day = {
      activities: [stop("Tomb", "landmark", "09:00", 60), stop("Garden", "park", "10:00", 60), stop("Lunch place", "restaurant", "11:00", 60)],
    };
    // One place ahead, lunch would still start at 12:40, an hour and forty minutes late.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Lunch place", "12:40 Tomb", "14:00 Garden"]);
  });

  it("leaves a meal pushed an hour and a half or less in its place", () => {
    const day = { activities: [stop("Tomb", "landmark", "10:00", 120), stop("Lunch place", "restaurant", "13:00", 60)] };
    // The tomb goes to 11:20 and ends 13:20: lunch at 13:40, forty minutes late.
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Tomb", "13:40 Lunch place"]);
  });

  it("never takes a meal past the stop put in, or past another meal", () => {
    const afterSight = { activities: [stop("Lunch place", "restaurant", "09:00", 60)] };
    expect(timed(withStopAt(afterSight, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Lunch place"]);

    const twoMeals = {
      activities: [stop("Breakfast cafe", "cafe", "09:00", 60), stop("Lunch place", "restaurant", "10:00", 60)],
    };
    expect(timed(withStopAt(twoMeals, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "11:20 Breakfast cafe", "12:40 Lunch place"]);
  });

  it("keeps the rest of the day as the plan had it once a stop needn't move", () => {
    // The plan's own overlap later in the day isn't this step's to change.
    const day = { activities: [stop("Garden", "park", "15:00", 120), stop("Museum", "museum", "16:00", 60)] };
    expect(timed(withStopAt(day, MORNING_SIGHT))).toEqual(["08:00 Taj Mahal", "15:00 Garden", "16:00 Museum"]);
  });

  it("has no room when a stop would start after ten at night, or a dated event would move", () => {
    const late = {
      activities: [stop("Fort", "landmark", "10:00", 300), stop("Night market", "market", "16:00", 330), stop("Bar", "bar", "21:30", 60)],
    };
    expect(withStopAt(late, MORNING_SIGHT)).toBeNull();
    const event = { activities: [stop("Show", "event", "10:00", 60), stop("Lunch place", "restaurant", "12:00", 60)] };
    expect(withStopAt(event, MORNING_SIGHT)).toBeNull();
  });

  it("counts a stop with no length as an hour and a half", () => {
    expect(plannedMinutes({ activities: [stop("Fort", "landmark", "09:00", 120), { name: "Walk", start_time: "12:00" }] })).toBe(210);
    expect(timed(withStopAt({ activities: [{ name: "Walk", type: "walk", start_time: "07:00" }] }, MORNING_SIGHT))).toEqual([
      "07:00 Walk",
      "08:50 Taj Mahal",
    ]);
  });
});
