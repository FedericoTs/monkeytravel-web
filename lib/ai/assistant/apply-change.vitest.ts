// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { applyChange, invalidChange, type ApplyChangeRequest } from "./apply-change";

/**
 * What the Apply button does to a trip's days, before they are written: each kind
 * of change, what it keeps, and when it refuses. Nothing here touches a database.
 */

const act = (id: string, name: string, start: string, extra: Partial<Activity> = {}) =>
  ({ id, name, type: "attraction", time_slot: "morning", start_time: start, duration_minutes: 60, ...extra }) as Activity;
const threeDays = (locked?: string): ItineraryDay[] =>
  [
    { day_number: 1, date: "2027-03-11", activities: [act("a1", "Alpha", "09:00", { locked: locked === "a1" }), act("a2", "Bravo", "11:00")] },
    { day_number: 2, date: "2027-03-12", activities: [act("b1", "Echo", "10:00"), act("b2", "Golf", "12:00"), act("b3", "Hotel", "15:00")] },
    { day_number: 3, date: "2027-03-13", activities: [act("c1", "Foxtrot", "14:00", { locked: locked === "c1" })] },
  ] as ItineraryDay[];
const trip = (days: ItineraryDay[] = threeDays(), dates: { startDate?: string; endDate?: string } = {}) => ({
  itinerary: days,
  startDate: "2027-03-11",
  endDate: "2027-03-13",
  ...dates,
});
const change = (fields: Partial<ApplyChangeRequest>): ApplyChangeRequest => ({ tripId: "trip-1", changeType: "add", dayNumber: 1, ...fields });
const applied = (fields: Partial<ApplyChangeRequest>, t = trip(), role: "owner" | "editor" = "owner") => {
  const outcome = applyChange(change(fields), t, role);
  if (outcome.refused) throw new Error(`refused: ${outcome.refused.status}`);
  return outcome.applied;
};
const refused = async (fields: Partial<ApplyChangeRequest>, t = trip(), role: "owner" | "editor" = "owner") => {
  const outcome = applyChange(change(fields), t, role);
  if (!outcome.refused) throw new Error("applied");
  return { status: outcome.refused.status, body: await outcome.refused.json() };
};
const names = (day: ItineraryDay) => day.activities.map((a) => a.name);
const newDay = (n: number, date = "2020-01-01", extra: Partial<ItineraryDay> = {}) =>
  ({ day_number: n, date, activities: [act(`n${n}`, `New ${n}`, "10:00")], ...extra }) as ItineraryDay;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("whether a change is complete", () => {
  it.each<[string, Partial<ApplyChangeRequest>]>([
    ["no trip", { tripId: "" }],
    ["no type", { changeType: undefined }],
    ["a day number that is not a number", { dayNumber: "1" as never }],
    ["a type nothing makes", { changeType: "swap" as never }],
    ["a replacement with nothing to put in", { changeType: "replace" }],
    ["an addition with nothing to add", { changeType: "add" }],
    ["a duration with no activity", { changeType: "adjust_duration", newDuration: 30 }],
    ["a duration with no minutes", { changeType: "adjust_duration", activity: { id: "a", name: "A", type: "x" } }],
    ["a new day with no activities", { changeType: "add_day", day: newDay(4, "x", { activities: [] }) }],
    ["a draft with no days", { changeType: "apply_draft", days: [] }],
    ["a shift of nothing", { changeType: "shift_days", shiftByDays: 0 }],
    ["a shift of more than a week", { changeType: "shift_days", shiftByDays: 8 }],
    ["a shift of part of a day", { changeType: "shift_days", shiftByDays: 1.5 }],
  ])("refuses %s", (_name, fields) => {
    expect(invalidChange(change(fields))).toEqual(expect.any(String));
  });

  it.each<[string, Partial<ApplyChangeRequest>]>([
    ["an addition", { changeType: "add", newActivity: act("n", "N", "09:00") }],
    ["a shift of a week", { changeType: "shift_days", shiftByDays: 7 }],
    ["a duration of nothing", { changeType: "adjust_duration", activity: { id: "a", name: "A", type: "x" }, newDuration: 0 }],
    ["a change on day 0", { changeType: "add", dayNumber: 0, newActivity: act("n", "N", "09:00") }],
  ])("lets through %s", (_name, fields) => {
    expect(invalidChange(change(fields))).toBeNull();
  });
});

describe("the trip's own days", () => {
  it("are never changed in place: the change works on a copy", () => {
    const days = threeDays();
    const before = JSON.stringify(days);
    applied({ changeType: "remove", oldActivity: days[0].activities[0] }, trip(days));
    applied({ changeType: "shift_days", shiftByDays: 2, dayNumber: 1 }, trip(days));
    applied({ changeType: "adjust_duration", dayNumber: 2, activity: { id: "b1", name: "Echo", type: "x" }, newDuration: 200 }, trip(days));
    expect(JSON.stringify(days)).toBe(before);
  });

  it.each([0, 4])("refuse a change on a day they do not have: day %i", async (dayNumber) => {
    expect((await refused({ changeType: "add", dayNumber, newActivity: act("n", "N", "09:00") })).status).toBe(400);
  });
});

describe("replacing an activity", () => {
  it("keeps the replaced one's time, found by id or by name", () => {
    const next = act("n", "Charlie", "23:00", { time_slot: "evening" });
    for (const oldActivity of [act("a2", "Renamed", "00:00"), act("gone", "Bravo", "00:00")]) {
      const day = applied({ changeType: "replace", oldActivity, newActivity: { ...next } }).days[0];
      expect(names(day)).toEqual(["Alpha", "Charlie"]);
      expect(day.activities[1]).toMatchObject({ start_time: "11:00", time_slot: "morning" });
    }
  });

  it("says when the activity is gone, and is named for what comes in", async () => {
    const newActivity = act("n", "Charlie", "23:00");
    expect(applied({ changeType: "replace", oldActivity: act("a2", "Bravo", "11:00"), newActivity }).name).toBe("Charlie");
    expect(await refused({ changeType: "replace", oldActivity: act("zz", "Nope", "11:00"), newActivity })).toMatchObject({ status: 404, body: { code: "OUTDATED" } });
  });
});

describe("adding an activity", () => {
  it("places it by time", () => {
    expect(names(applied({ changeType: "add", newActivity: act("n", "Charlie", "10:00") }).days[0])).toEqual(["Alpha", "Charlie", "Bravo"]);
  });
});

describe("removing an activity", () => {
  it("takes it out, and only it", async () => {
    const { days } = applied({ changeType: "remove", oldActivity: act("a1", "Alpha", "09:00") });
    expect(names(days[0])).toEqual(["Bravo"]);
    expect(names(days[1])).toEqual(["Echo", "Golf", "Hotel"]);
    expect((await refused({ changeType: "remove", oldActivity: act("zz", "Nope", "11:00") })).status).toBe(404);
  });
});

describe("adjusting a duration", () => {
  const adjust = (id: string, name: string, newDuration: number) =>
    applied({ changeType: "adjust_duration", dayNumber: 2, activity: { id, name, type: "x" }, newDuration }).days[1].activities;

  it("sets it, and everything after it follows on", () => {
    const [echo, golf, hotel] = adjust("b1", "Echo", 180);
    expect(echo).toMatchObject({ duration_minutes: 180, start_time: "10:00" });
    expect(golf.start_time).toBe("13:00");
    expect(hotel.start_time).toBe("14:00");
  });

  it("leaves what comes before it alone", () => {
    const [echo, golf, hotel] = adjust("b2", "Golf", 30);
    expect(echo.start_time).toBe("10:00");
    expect(golf.start_time).toBe("12:00");
    expect(hotel.start_time).toBe("12:30");
  });

  it("is named for the activity", async () => {
    expect(applied({ changeType: "adjust_duration", dayNumber: 2, activity: { id: "b1", name: "Echo", type: "x" }, newDuration: 30 }).name).toBe("Echo");
    expect((await refused({ changeType: "adjust_duration", dayNumber: 2, activity: { id: "z", name: "Z", type: "x" }, newDuration: 30 })).status).toBe(404);
  });
});

describe("shifting days", () => {
  it("moves the days from that one on, and the end date, leaving the start", () => {
    const made = applied({ changeType: "shift_days", dayNumber: 2, shiftByDays: 2 });
    expect(made.days.map((d) => d.date)).toEqual(["2027-03-11", "2027-03-14", "2027-03-15"]);
    expect(made.days.map((d) => d.day_number)).toEqual([1, 2, 3]);
    expect(made).toMatchObject({ newEndDate: "2027-03-15", newStartDate: null, dayCount: 2, name: "Day 2–3 +2d", dayNumber: 2 });
  });

  it("moves the start too when the whole trip moves", () => {
    expect(applied({ changeType: "shift_days", dayNumber: 1, shiftByDays: 1 })).toMatchObject({ newStartDate: "2027-03-12", newEndDate: "2027-03-14", dayCount: 3 });
  });

  it("falls back on the last day when the end date cannot be read", () => {
    expect(applied({ changeType: "shift_days", dayNumber: 2, shiftByDays: 1 }, trip(threeDays(), { endDate: "nonsense" })).newEndDate).toBe("2027-03-14");
  });

  it("counts only the days it could move, and refuses when it could move none", async () => {
    const undated = [{ day_number: 1, date: "someday", activities: [] }] as unknown as ItineraryDay[];
    expect((await refused({ changeType: "shift_days", shiftByDays: 1 }, trip(undated))).status).toBe(400);
    const mixed = [...undated, { day_number: 2, date: "2027-03-12", activities: [] }] as unknown as ItineraryDay[];
    expect(applied({ changeType: "shift_days", shiftByDays: 1 }, trip(mixed)).dayCount).toBe(1);
  });
});

describe("adding a day", () => {
  it("follows the stored last day, whatever number and date the preview had", () => {
    const made = applied({ changeType: "add_day", dayNumber: 2, day: newDay(2, "2020-01-01", { theme: "Howth" }) });
    expect(made.days).toHaveLength(4);
    expect(made.days[3]).toMatchObject({ day_number: 4, date: "2027-03-14", theme: "Howth" });
    expect(made).toMatchObject({ dayNumber: 4, newEndDate: "2027-03-14", name: "Howth" });
    expect(made).not.toHaveProperty("dayCount");
  });

  it("is named for its first activity when it has no theme", () => {
    expect(applied({ changeType: "add_day", day: newDay(4) }).name).toBe("New 4");
  });

  it("leaves the end date when the new day falls inside it", () => {
    expect(applied({ changeType: "add_day", day: newDay(4) }, trip(threeDays(), { endDate: "2027-03-20" })).newEndDate).toBeNull();
  });

  it("stays in the last day's city unless it names its own", () => {
    const inDublin = threeDays().map((d) => ({ ...d, city: "Dublin" }));
    expect(applied({ changeType: "add_day", day: newDay(4) }, trip(inDublin)).days[3].city).toBe("Dublin");
    expect(applied({ changeType: "add_day", day: newDay(4, "x", { city: "Howth" }) }, trip(inDublin)).days[3].city).toBe("Howth");
  });

  it("gives every activity an id", () => {
    const day = { day_number: 4, activities: [{ name: "No id", type: "attraction" }] } as unknown as ItineraryDay;
    expect(applied({ changeType: "add_day", day }).days[3].activities[0].id).toBeTruthy();
  });

  it("refuses past the maximum", async () => {
    const full = Array.from({ length: 14 }, (_, i) => newDay(i + 1, `2027-04-${String(i + 1).padStart(2, "0")}`));
    expect(await refused({ changeType: "add_day", day: newDay(15) }, trip(full))).toMatchObject({ status: 400, body: { code: "TOO_MANY_DAYS", max: 14 } });
    expect(applied({ changeType: "add_day", day: newDay(14) }, trip(full.slice(0, 13))).days).toHaveLength(14);
  });
});

describe("applying a draft", () => {
  it("replaces the days it names, keeping each one's number, date and city", () => {
    const stored = threeDays().map((d) => ({ ...d, city: "Dublin" }));
    const made = applied({ changeType: "apply_draft", days: [newDay(2, "2020-01-01", { city: "Elsewhere", theme: "Revised" })] }, trip(stored));
    expect(made.days[1]).toMatchObject({ day_number: 2, date: "2027-03-12", city: "Dublin", theme: "Revised" });
    expect(names(made.days[1])).toEqual(["New 2"]);
    expect(names(made.days[0])).toEqual(["Alpha", "Bravo"]);
    expect(made).toMatchObject({ dayNumber: 2, dayCount: 1, newEndDate: null });
  });

  it("is keyed on the first day it changed, in its own order", () => {
    expect(applied({ changeType: "apply_draft", dayNumber: 9, days: [newDay(3), newDay(1)] })).toMatchObject({ dayNumber: 3, dayCount: 2 });
  });

  it("adds days past the end in order, numbered and dated from the stored last day, and moves the end date", () => {
    const made = applied({ changeType: "apply_draft", dayNumber: 5, days: [newDay(6, "x", { theme: "Later" }), newDay(5, "y", { theme: "Sooner" })] });
    expect(made.days.slice(3).map((d) => [d.day_number, d.date, d.theme])).toEqual([
      [4, "2027-03-14", "Sooner"],
      [5, "2027-03-15", "Later"],
    ]);
    expect(made).toMatchObject({ dayNumber: 4, dayCount: 2, newEndDate: "2027-03-15" });
  });

  it("counts the days it changed and the days it added together", () => {
    expect(applied({ changeType: "apply_draft", days: [newDay(3), newDay(4)] })).toMatchObject({ dayNumber: 3, dayCount: 2, newEndDate: "2027-03-14" });
  });

  it("skips what it cannot place, and refuses when that is everything", async () => {
    const empty = newDay(4, "x", { activities: [] });
    expect(applied({ changeType: "apply_draft", days: [null as never, empty, newDay(1)] }).dayCount).toBe(1);
    expect(await refused({ changeType: "apply_draft", days: [empty] })).toMatchObject({ status: 400, body: { code: "OUTDATED" } });
  });

  it("leaves adding days to the owner, though an editor can revise", async () => {
    expect(applied({ changeType: "apply_draft", days: [newDay(1)] }, trip(), "editor").dayCount).toBe(1);
    expect(await refused({ changeType: "apply_draft", days: [newDay(1), newDay(4)] }, trip(), "editor")).toMatchObject({ status: 403, body: { code: "DATES_OWNER_ONLY" } });
  });

  it("refuses to go past the cap", async () => {
    const full = Array.from({ length: 14 }, (_, i) => newDay(i + 1, `2027-04-${String(i + 1).padStart(2, "0")}`));
    expect(await refused({ changeType: "apply_draft", days: [newDay(15)] }, trip(full))).toMatchObject({ status: 400, body: { code: "TOO_MANY_DAYS", max: 14 } });
  });

  it("gives every activity an id", () => {
    const day = { day_number: 1, activities: [{ name: "No id", type: "attraction" }] } as unknown as ItineraryDay;
    expect(applied({ changeType: "apply_draft", days: [day] }).days[0].activities[0].id).toBeTruthy();
  });
});

describe("a fixed plan", () => {
  const fixed = () => trip(threeDays("a1"));

  it.each<[string, Partial<ApplyChangeRequest>]>([
    ["replaced", { changeType: "replace", oldActivity: act("a1", "Alpha", "09:00"), newActivity: act("n", "N", "09:00") }],
    ["removed", { changeType: "remove", oldActivity: act("a1", "Alpha", "09:00") }],
    ["removed, found by name", { changeType: "remove", oldActivity: act("gone", "Alpha", "09:00") }],
    ["resized", { changeType: "adjust_duration", activity: { id: "a1", name: "Alpha", type: "x" }, newDuration: 30 }],
  ])("cannot be %s", async (_name, fields) => {
    expect(await refused(fields, fixed())).toMatchObject({ status: 400, body: { code: "LOCKED", names: ["Alpha"] } });
  });

  it("does not stop a change to what is beside it", () => {
    expect(names(applied({ changeType: "remove", oldActivity: act("a2", "Bravo", "11:00") }, fixed()).days[0])).toEqual(["Alpha"]);
    expect(names(applied({ changeType: "add", newActivity: act("n", "N", "12:00") }, fixed()).days[0])).toEqual(["Alpha", "Bravo", "N"]);
  });

  it("stops a draft only on the day that holds it", async () => {
    expect(await refused({ changeType: "apply_draft", days: [newDay(1)] }, fixed())).toMatchObject({ status: 400, body: { code: "LOCKED", names: ["Alpha"] } });
    expect(applied({ changeType: "apply_draft", days: [newDay(2)] }, fixed()).dayCount).toBe(1);
  });

  it("stops a shift only when its date would move", async () => {
    expect(await refused({ changeType: "shift_days", dayNumber: 2, shiftByDays: 1 }, trip(threeDays("c1")))).toMatchObject({ status: 400, body: { code: "LOCKED", names: ["Foxtrot"] } });
    expect(applied({ changeType: "shift_days", dayNumber: 2, shiftByDays: 1 }, fixed()).dayCount).toBe(2);
  });
});
