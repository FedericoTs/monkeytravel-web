import { describe, it, expect } from "vitest";
import type { ItineraryDay, Activity } from "@/types";
import {
  applyMove,
  dayDropId,
  dayHeaderId,
  describeMove,
  dragAnnouncements,
  isSameDayTarget,
  locateActivity,
  parseDropId,
  resolveTarget,
  stopPlace,
} from "./itinerary-dnd";

const act = (id: string, start = "09:00"): Activity =>
  ({ id, name: id, type: "attraction", start_time: start, duration_minutes: 60 }) as unknown as Activity;

const day = (day_number: number, ...activities: Activity[]): ItineraryDay =>
  ({ day_number, date: `2026-10-0${day_number}`, activities }) as ItineraryDay;

const base = (): ItineraryDay[] => [
  day(1, act("a1", "09:00"), act("a2", "12:00"), act("a3", "18:00")),
  day(2, act("b1", "10:00"), act("b2", "15:00")),
  day(3),
];

const ids = (it: ItineraryDay[]) => it.map((d) => d.activities.map((a) => a.id));

describe("drop ids", () => {
  it("round-trips day and header ids and treats anything else as an activity", () => {
    expect(parseDropId(dayDropId(2))).toEqual({ kind: "day", dayNumber: 2 });
    expect(parseDropId(dayHeaderId(3))).toEqual({ kind: "header", dayNumber: 3 });
    expect(parseDropId("a1")).toEqual({ kind: "activity", activityId: "a1" });
  });
});

describe("locateActivity / resolveTarget", () => {
  it("finds an activity's day and index", () => {
    expect(locateActivity(base(), "b2")).toEqual({ dayIndex: 1, index: 1 });
    expect(locateActivity(base(), "nope")).toBeNull();
  });

  it("a header means the start of that day, a day list means its end", () => {
    expect(resolveTarget(base(), { kind: "header", dayNumber: 2 }, "a1")).toEqual({ dayIndex: 1, index: 0 });
    expect(resolveTarget(base(), { kind: "day", dayNumber: 2 }, "a1")).toEqual({ dayIndex: 1, index: 2 });
    expect(resolveTarget(base(), { kind: "day", dayNumber: 3 }, "a1")).toEqual({ dayIndex: 2, index: 0 });
  });

  it("hovering the card itself is not a target", () => {
    expect(resolveTarget(base(), { kind: "activity", activityId: "a1" }, "a1")).toBeNull();
  });
});

describe("applyMove", () => {
  it("reorders within a day", () => {
    const next = applyMove(base(), "a3", "a1");
    expect(ids(next)[0]).toEqual(["a3", "a1", "a2"]);
    expect(ids(next)[1]).toEqual(["b1", "b2"]);
  });

  it("moves across days, landing before the hovered card by default", () => {
    const next = applyMove(base(), "a2", "b2");
    expect(ids(next)).toEqual([["a1", "a3"], ["b1", "a2", "b2"], []]);
  });

  it("lands after the hovered card when the pointer is in its lower half", () => {
    const next = applyMove(base(), "a2", "b2", { after: true });
    expect(ids(next)[1]).toEqual(["b1", "b2", "a2"]);
  });

  it("drops on a header at the start of that day", () => {
    const next = applyMove(base(), "a3", dayHeaderId(2));
    expect(ids(next)[1]).toEqual(["a3", "b1", "b2"]);
    expect(ids(next)[0]).toEqual(["a1", "a2"]);
  });

  it("drops on an empty day's list", () => {
    const next = applyMove(base(), "b1", dayDropId(3));
    expect(ids(next)).toEqual([["a1", "a2", "a3"], ["b2"], ["b1"]]);
  });

  it("drops on a day list at the end, and is stable once already last", () => {
    const first = applyMove(base(), "a1", dayDropId(2));
    expect(ids(first)[1]).toEqual(["b1", "b2", "a1"]);
    const again = applyMove(first, "a1", dayDropId(2));
    expect(again).toBe(first);
  });

  it("returns the same reference for no-op steps", () => {
    const it = base();
    expect(applyMove(it, "a1", "a1")).toBe(it);
    expect(applyMove(it, "ghost", "a1")).toBe(it);
    expect(applyMove(it, "a1", "ghost")).toBe(it);
    expect(applyMove(it, "a1", dayDropId(9))).toBe(it);
  });

  it("does not mutate its input", () => {
    const it = base();
    const snapshot = JSON.stringify(it);
    applyMove(it, "a2", dayHeaderId(3));
    expect(JSON.stringify(it)).toBe(snapshot);
  });
});

describe("isSameDayTarget", () => {
  it("is true for cards, the list and the header of the active card's own day", () => {
    expect(isSameDayTarget(base(), "a1", "a3")).toBe(true);
    expect(isSameDayTarget(base(), "a1", dayDropId(1))).toBe(true);
    expect(isSameDayTarget(base(), "a1", dayHeaderId(1))).toBe(true);
  });

  it("is false across days or for unknown targets", () => {
    expect(isSameDayTarget(base(), "a1", "b1")).toBe(false);
    expect(isSameDayTarget(base(), "a1", dayDropId(3))).toBe(false);
    expect(isSameDayTarget(base(), "a1", "ghost")).toBe(false);
    expect(isSameDayTarget(base(), "ghost", "a1")).toBe(false);
  });
});

describe("describeMove", () => {
  it("reports whether a drag crossed days", () => {
    const before = base();
    expect(describeMove(before, applyMove(before, "a1", "a3"), "a1")).toEqual({
      sourceDayIndex: 0,
      targetDayIndex: 0,
      crossedDays: false,
    });
    expect(describeMove(before, applyMove(before, "a1", dayDropId(3)), "a1")).toEqual({
      sourceDayIndex: 0,
      targetDayIndex: 2,
      crossedDays: true,
    });
    expect(describeMove(before, before, "ghost")).toBeNull();
  });
});

describe("stopPlace: where a dragged stop is, or lands", () => {
  it("names the stop, its day and its place in that day", () => {
    expect(stopPlace(base(), "a2")).toEqual({ name: "a2", day: 1, position: 2, count: 3 });
    expect(stopPlace(base(), "nope")).toBeNull();
  });

  it("says where a drop on a stop, a day or a day's header puts it, as the drop does", () => {
    expect(stopPlace(base(), "a3", "a1")).toEqual({ name: "a3", day: 1, position: 1, count: 3 });
    expect(stopPlace(base(), "a1", "b2")).toEqual({ name: "a1", day: 2, position: 2, count: 3 });
    expect(stopPlace(base(), "a1", dayDropId(2))).toEqual({ name: "a1", day: 2, position: 3, count: 3 });
    expect(stopPlace(base(), "b2", dayHeaderId(1))).toEqual({ name: "b2", day: 1, position: 1, count: 4 });
    expect(stopPlace(base(), "a2", dayDropId(3))).toEqual({ name: "a2", day: 3, position: 1, count: 1 });
  });
});

describe("dragAnnouncements", () => {
  const say = (key: string, p: { name: string; day: number; position: number; count: number }) =>
    `${key}: ${p.name} ${p.position}/${p.count} day ${p.day}`;

  it("says the stop and its place when picked up, moved and dropped, from the plan as shown", () => {
    // While dragging, the page shows a1 already moved to day 2.
    const shown = applyMove(base(), "a1", dayDropId(2));
    const tell = dragAnnouncements(say, () => shown, () => base());
    expect(tell.onDragStart({ active: { id: "a1" } })).toBe("pickedUp: a1 3/3 day 2");
    expect(tell.onDragOver({ active: { id: "a1" }, over: { id: "b1" } })).toBe("over: a1 1/3 day 2");
    expect(tell.onDragEnd({ active: { id: "a1" }, over: { id: dayHeaderId(1) } })).toBe("dropped: a1 1/3 day 1");
    expect(tell.onDragEnd({ active: { id: "a1" }, over: null })).toBe("dropped: a1 3/3 day 2");
  });

  it("says a cancelled move put the stop back where it was", () => {
    const shown = applyMove(base(), "a1", dayDropId(2));
    const tell = dragAnnouncements(say, () => shown, () => base());
    expect(tell.onDragCancel({ active: { id: "a1" } })).toBe("cancelled: a1 1/3 day 1");
  });

  it("says nothing over no target, or for a stop it can't find", () => {
    const tell = dragAnnouncements(say, () => base(), () => base());
    expect(tell.onDragOver({ active: { id: "a1" }, over: null })).toBeUndefined();
    expect(tell.onDragStart({ active: { id: "gone" } })).toBeUndefined();
  });
});
