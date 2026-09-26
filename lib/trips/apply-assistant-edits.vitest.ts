import { describe, it, expect } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { applyAssistantEdits } from "./day-edit-merge";

/**
 * One assistant reply can now change several days (a move or swap between
 * days) and the trip's length. Moved activities keep their id and photo; ids
 * stay unique across the trip. (2026-09-26: a swap request came back as a
 * one-day edit, and "add one more day" couldn't be done at all.)
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
