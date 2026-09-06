import { describe, expect, it } from "vitest";
import type { Activity } from "@/types";
import {
  feedDescriptor,
  isDayDone,
  overlayFor,
  parseTodayActionType,
  runningLateMinutes,
  type TodayAction,
} from "./actions";

const act = (id: string, start: string): Activity =>
  ({ id, name: id, start_time: start, duration_minutes: 60, time_slot: "morning", description: "", location: "" }) as Activity;

const action = (over: Partial<TodayAction>): TodayAction => ({
  id: Math.random().toString(36).slice(2),
  day_number: 2,
  action_type: "skip",
  activity_id: null,
  payload: {},
  actor_name: "Ana",
  actor_role: "participant",
  created_at: "2026-09-06T10:00:00Z",
  undone_at: null,
  ...over,
});

describe("parseTodayActionType", () => {
  it("accepts the four types and rejects others", () => {
    expect(parseTodayActionType("skip")).toBe("skip");
    expect(parseTodayActionType("running_late")).toBe("running_late");
    expect(parseTodayActionType("nope")).toBeNull();
    expect(parseTodayActionType(2)).toBeNull();
  });
});

describe("runningLateMinutes", () => {
  it("sums active running-late actions and caps", () => {
    const a = [
      action({ action_type: "running_late", payload: { minutes: 30 } }),
      action({ action_type: "running_late", payload: { minutes: 60 }, actor_name: "Bob" }),
      action({ action_type: "running_late", payload: { minutes: 30 }, undone_at: "x" }), // undone → ignored
      action({ action_type: "running_late", payload: { minutes: 30 }, day_number: 3 }), // other day → ignored
    ];
    expect(runningLateMinutes(a, 2)).toBe(90);
  });
  it("caps at 240", () => {
    const a = Array.from({ length: 10 }, () => action({ action_type: "running_late", payload: { minutes: 60 } }));
    expect(runningLateMinutes(a, 2)).toBe(240);
  });
});

describe("overlayFor", () => {
  it("shifts pending activities but not skipped/done ones", () => {
    const actions = [
      action({ action_type: "skip", activity_id: "a2" }),
      action({ action_type: "done", activity_id: "a3", actor_name: "Bob" }),
    ];
    const shift = 30;
    expect(overlayFor(act("a1", "09:00"), actions, 2, shift).displayStartTime).toBe("09:30");
    const skipped = overlayFor(act("a2", "12:00"), actions, 2, shift);
    expect(skipped.skipped).toBe(true);
    expect(skipped.skippedBy).toBe("Ana");
    expect(skipped.displayStartTime).toBe("12:00"); // not shifted
    const done = overlayFor(act("a3", "15:00"), actions, 2, shift);
    expect(done.done).toBe(true);
    expect(done.displayStartTime).toBe("15:00");
  });

  it("clamps a shift within the day", () => {
    expect(overlayFor(act("a1", "23:50"), [], 2, 60).displayStartTime).toBe("23:59");
  });

  it("attaches a swap suggestion", () => {
    const actions = [action({ action_type: "swap", activity_id: "a1", payload: { swap_to: { name: "Café B", why: "closer" } }, actor_name: "Bob" })];
    const o = overlayFor(act("a1", "10:00"), actions, 2, 0);
    expect(o.swap?.name).toBe("Café B");
    expect(o.swapBy).toBe("Bob");
  });
});

describe("isDayDone", () => {
  it("is true only for a day-level done", () => {
    expect(isDayDone([action({ action_type: "done", activity_id: null })], 2)).toBe(true);
    expect(isDayDone([action({ action_type: "done", activity_id: "a1" })], 2)).toBe(false);
  });
});

describe("feedDescriptor", () => {
  it("returns a locale-agnostic descriptor per type", () => {
    expect(feedDescriptor(action({ action_type: "running_late", payload: { minutes: 30 } }), null)).toMatchObject({ key: "runningLate", params: { minutes: 30 } });
    expect(feedDescriptor(action({ action_type: "skip", activity_id: "a1" }), "Lunch")).toMatchObject({ key: "skip", params: { activity: "Lunch" } });
    expect(feedDescriptor(action({ action_type: "swap", activity_id: "a1", payload: { swap_to: { name: "Café B" } } }), "Café A")).toMatchObject({ key: "swap", params: { activity: "Café A", to: "Café B" } });
    expect(feedDescriptor(action({ action_type: "swap", activity_id: "a1", payload: {} }), "Café A")).toMatchObject({ key: "swapNoName" });
    expect(feedDescriptor(action({ action_type: "done", activity_id: null }), null)).toMatchObject({ key: "doneDay" });
  });
  it("classifies the actor", () => {
    expect(feedDescriptor(action({ actor_name: "Ana" }), "x").who).toEqual({ kind: "name", name: "Ana" });
    expect(feedDescriptor(action({ actor_name: null, actor_role: "owner" }), "x").who).toEqual({ kind: "owner" });
    expect(feedDescriptor(action({ actor_name: null, actor_role: "participant" }), "x").who).toEqual({ kind: "someone" });
  });
});
