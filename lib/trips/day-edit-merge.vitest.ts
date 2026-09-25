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

  it("a revisit (the same place twice in the new day) gets a fresh id the second time", () => {
    const out = mergeDayEditActivities(days(), 2, [act("Orsay"), act("Lunch"), act("Orsay")]);
    expect(out[0].id).toBe("X2");
    expect(new Set(ids(out)).size).toBe(3);
    expect(out[2].id).toMatch(/^edit-2-2-orsay/);
  });

  it("carries coordinates and photos over from the matched activity only", () => {
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
