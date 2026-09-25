import { describe, it, expect } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { mergeDayEditActivities } from "./day-edit-merge";

/**
 * The wizard's "apply this day edit": ids are carried over by name, each
 * existing activity at most once, and never shared (deleting one of two
 * activities with the same id deletes both on the trip page).
 */

const act = (name: string, extra: Partial<Activity> = {}) => ({ name, ...extra }) as unknown as Activity;
const days = (): ItineraryDay[] =>
  [
    { day_number: 1, date: "2027-01-01", activities: [act("Louvre Museum", { id: "d1a" }), act("Cafe", { id: "d1b" })] },
    {
      day_number: 2,
      date: "2027-01-02",
      activities: [
        act("Free time", { id: "X1", coordinates: { lat: 1, lng: 1 } as never }),
        act("Orsay", { id: "X2", image_url: "/api/places/photo?ref=orsay" }),
        act("Free time", { id: "X3" }),
      ],
    },
  ] as unknown as ItineraryDay[];

const ids = (acts: Activity[]) => acts.map((a) => a.id);

describe("mergeDayEditActivities", () => {
  it("two same-named entries keep their two different ids", () => {
    const out = mergeDayEditActivities(days(), 2, [act("Free time"), act("Orsay"), act("Free time")]);
    expect(ids(out)).toEqual(["X1", "X2", "X3"]);
  });

  it("a revisit (the same place twice in the new day) gets its own id but keeps the place's photo and pin", () => {
    const out = mergeDayEditActivities(days(), 2, [act("Orsay"), act("Lunch"), act("Orsay")]);
    expect(out[0].id).toBe("X2");
    expect(new Set(ids(out)).size).toBe(3);
    expect(out[2].id).toMatch(/^edit-2-2-orsay/);
    expect(out[2].image_url).toBe("/api/places/photo?ref=orsay");
  });

  it("dropping the earlier of two same-named activities keeps the later one's id and place (closest start time)", () => {
    const d = [
      {
        day_number: 1,
        date: "2027-01-01",
        activities: [
          act("Free time", { id: "F1", start_time: "10:00", coordinates: { lat: 48.86, lng: 2.36 } as never }),
          act("Louvre", { id: "L" }),
          act("Free time", { id: "F2", start_time: "17:00", coordinates: { lat: 48.88, lng: 2.34 } as never }),
        ],
      },
    ] as unknown as ItineraryDay[];
    const out = mergeDayEditActivities(d, 1, [act("Cafe X", { start_time: "09:00" }), act("Louvre"), act("Free time", { start_time: "17:00" })]);
    expect(out[2].id).toBe("F2");
    expect(out[2].coordinates).toEqual({ lat: 48.88, lng: 2.34 });
    expect(out[1].id).toBe("L");
  });

  it("carries coordinates and photos over from the same-named activity", () => {
    const out = mergeDayEditActivities(days(), 2, [act("Orsay"), act("Free time")]);
    expect(out[0].image_url).toBe("/api/places/photo?ref=orsay");
    expect(out[1].coordinates).toEqual({ lat: 1, lng: 1 });
  });

  it("never reuses an id that belongs to another day, nor one the assistant repeated", () => {
    const out = mergeDayEditActivities(days(), 2, [act("New A", { id: "d1a" }), act("New B", { id: "dup" }), act("New C", { id: "dup" })]);
    const all = [...ids(out), "d1a", "d1b"];
    expect(new Set(all).size).toBe(all.length);
  });
});
