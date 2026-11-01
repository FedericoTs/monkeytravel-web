import { describe, it, expect } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { applyAssistantEdits } from "./day-edit-merge";

/**
 * One assistant reply can change several days (a move or swap between days)
 * and the trip's length. Moved activities keep their id and photo; ids stay
 * unique across the trip, since deleting one of two activities that share an
 * id deletes both on the trip page.
 */

const act = (name: string, extra: Partial<Activity> = {}) => ({ name, start_time: "10:00", ...extra }) as unknown as Activity;
const trip = (): ItineraryDay[] =>
  [
    { day_number: 1, date: "2027-11-11", city: "Tromsø", activities: [act("Arrival walk", { id: "a1" })] },
    {
      day_number: 2,
      date: "2027-11-12",
      city: "Tromsø",
      activities: [act("Northern Lights Chase", { id: "nl", image_url: "/p/nl", start_time: "20:00" }), act("Polaria", { id: "po" })],
    },
    {
      day_number: 3,
      date: "2027-11-13",
      city: "Tromsø",
      activities: [act("Orca Watching", { id: "orca", image_url: "/p/orca", coordinates: { lat: 69, lng: 19 } as never })],
    },
  ] as unknown as ItineraryDay[];

const names = (d: ItineraryDay) => d.activities.map((a) => a.name);

describe("applyAssistantEdits", () => {
  it("a swap between two days keeps each moved activity's id and photo", () => {
    const out = applyAssistantEdits(trip(), [
      { day_number: 2, activities: [act("Orca Watching"), act("Polaria")] },
      { day_number: 3, activities: [act("Northern Lights Chase", { start_time: "20:00" })] },
    ]);
    const orca = out[1].activities[0];
    const lights = out[2].activities[0];
    expect(names(out[1])).toEqual(["Orca Watching", "Polaria"]);
    expect(orca.id).toBe("orca");
    expect(orca.image_url).toBe("/p/orca");
    expect(orca.coordinates).toEqual({ lat: 69, lng: 19 });
    expect(lights.id).toBe("nl");
    expect(lights.image_url).toBe("/p/nl");
    expect(out[1].activities[1].id).toBe("po");
  });

  it("adds a day at the end, dated and placed after the last one", () => {
    const out = applyAssistantEdits(trip(), [{ day_number: 4, activities: [act("Reindeer sledding in Lyngen")], theme: "Lyngen" }], {
      tripLength: 4,
      startDate: "2027-11-11",
    });
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ day_number: 4, date: "2027-11-14", city: "Tromsø", theme: "Lyngen" });
    expect(names(out[3])).toEqual(["Reindeer sledding in Lyngen"]);
    expect(out[3].activities[0].id).toMatch(/^edit-4-0-/);
  });

  it("shortens the trip by dropping trailing days", () => {
    const out = applyAssistantEdits(trip(), [], { tripLength: 2 });
    expect(out.map((d) => d.day_number)).toEqual([1, 2]);
  });

  it("rebalances cities: rewritten days take the new city", () => {
    const out = applyAssistantEdits(trip(), [{ day_number: 3, city: "Lyngen", activities: [act("Fjord drive")] }]);
    expect(out[2].city).toBe("Lyngen");
    expect(out[1].city).toBe("Tromsø");
  });

  it("leaves days nobody edited exactly as they were", () => {
    const before = trip();
    const out = applyAssistantEdits(before, [{ day_number: 3, activities: [act("Fjord drive")] }]);
    expect(out[0]).toBe(before[0]);
    expect(out[1]).toBe(before[1]);
  });

  it("never reuses an id held by an unedited day, even for the same name", () => {
    const out = applyAssistantEdits(trip(), [{ day_number: 3, activities: [act("Polaria", { id: "po" })] }]);
    const ids = out.flatMap((d) => d.activities.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(out[1].activities[1].id).toBe("po");
    expect(out[2].activities[0].id).not.toBe("po");
  });

  it("ignores an edit for a day beyond the trip's length", () => {
    const out = applyAssistantEdits(trip(), [{ day_number: 9, activities: [act("Nowhere")] }]);
    expect(out).toHaveLength(3);
    expect(out.flatMap(names)).not.toContain("Nowhere");
  });
});

describe("applyAssistantEdits on one day", () => {
  const paris = (day2: Activity[]): ItineraryDay[] =>
    [
      { day_number: 1, date: "2027-01-01", activities: [act("Louvre Museum", { id: "d1a" }), act("Cafe", { id: "d1b" })] },
      { day_number: 2, date: "2027-01-02", activities: day2 },
    ] as unknown as ItineraryDay[];
  const day2 = () => [
    act("Free time", { id: "X1", coordinates: { lat: 1, lng: 1 } as never }),
    act("Orsay", { id: "X2", image_url: "/api/places/photo?ref=orsay" }),
    act("Free time", { id: "X3" }),
  ];
  const edit = (days: ItineraryDay[], activities: Activity[]) => applyAssistantEdits(days, [{ day_number: 2, activities }])[1].activities;
  const ids = (acts: Activity[]) => acts.map((a) => a.id);

  it("two same-named entries keep their two different ids", () => {
    const out = edit(paris(day2()), [act("Free time"), act("Orsay"), act("Free time")]);
    expect(ids(out)).toEqual(["X1", "X2", "X3"]);
  });

  it("a revisit (the same place twice in the new day) gets its own id but keeps the place's photo", () => {
    const out = edit(paris(day2()), [act("Orsay"), act("Lunch"), act("Orsay")]);
    expect(out[0].id).toBe("X2");
    expect(new Set(ids(out)).size).toBe(3);
    expect(out[2].id).toMatch(/^edit-2-2-orsay/);
    expect(out[2].image_url).toBe("/api/places/photo?ref=orsay");
  });

  it("dropping the earlier of two same-named activities keeps the later one's id and place (closest start time)", () => {
    const days = paris([
      act("Free time", { id: "F1", start_time: "10:00", coordinates: { lat: 48.86, lng: 2.36 } as never }),
      act("Louvre", { id: "L" }),
      act("Free time", { id: "F2", start_time: "17:00", coordinates: { lat: 48.88, lng: 2.34 } as never }),
    ]);
    const out = edit(days, [act("Cafe X", { start_time: "09:00" }), act("Louvre"), act("Free time", { start_time: "17:00" })]);
    expect(out[2].id).toBe("F2");
    expect(out[2].coordinates).toEqual({ lat: 48.88, lng: 2.34 });
    expect(out[1].id).toBe("L");
  });

  it("carries coordinates and photos over from the same-named activity", () => {
    const out = edit(paris(day2()), [act("Orsay"), act("Free time")]);
    expect(out[0].image_url).toBe("/api/places/photo?ref=orsay");
    expect(out[1].coordinates).toEqual({ lat: 1, lng: 1 });
  });

  it("never reuses an id that belongs to another day, nor one the assistant repeated", () => {
    const out = edit(paris(day2()), [act("New A", { id: "d1a" }), act("New B", { id: "dup" }), act("New C", { id: "dup" })]);
    const all = [...ids(out), "d1a", "d1b"];
    expect(new Set(all).size).toBe(all.length);
  });
});
