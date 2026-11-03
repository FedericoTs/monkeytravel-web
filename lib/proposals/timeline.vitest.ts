// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Activity, ActivityProposal } from "@/types";
import { dayTimeline, type TimelineItem } from "./timeline";

/**
 * A day's list outside edit mode: its activities in order, with the crew's
 * open proposals for that day placed among them by start time.
 */

const activity = (id: string, start_time: string) => ({ id, name: id, start_time }) as Activity;
const proposal = (id: string, start_time: string, over: Partial<ActivityProposal> = {}) =>
  ({ id, target_day: 2, status: "voting", activity_data: { name: id, start_time }, ...over }) as ActivityProposal;
const order = (items: TimelineItem<ActivityProposal>[]) =>
  items.map((x) => (x.type === "activity" ? x.data.id : `+${x.data.id}`));

const day = [activity("breakfast", "08:00"), activity("museum", "10:00"), activity("dinner", "19:00")];
const none = new Set<string>();

describe("dayTimeline", () => {
  it("lists the day's activities in order, each with its place in the day", () => {
    expect(dayTimeline(day, [], 2, none)).toEqual([
      { type: "activity", data: day[0], index: 0 },
      { type: "activity", data: day[1], index: 1 },
      { type: "activity", data: day[2], index: 2 },
    ]);
  });

  it("places a proposal before the first entry that starts later, and last when none does", () => {
    const items = dayTimeline(day, [proposal("brunch", "09:00"), proposal("bar", "22:00")], 2, none);
    expect(order(items)).toEqual(["breakfast", "+brunch", "museum", "dinner", "+bar"]);
  });

  it("puts a proposal after an activity starting at the same time", () => {
    expect(order(dayTimeline(day, [proposal("gallery", "10:00")], 2, none))).toEqual([
      "breakfast",
      "museum",
      "+gallery",
      "dinner",
    ]);
  });

  it("places proposals among those already placed", () => {
    // Lunch goes before dinner; tea then goes before lunch, which starts later.
    const items = dayTimeline(day, [proposal("lunch", "13:00"), proposal("tea", "11:00")], 2, none);
    expect(order(items)).toEqual(["breakfast", "museum", "+tea", "+lunch", "dinner"]);
  });

  it("shows pending and voting proposals, and approved ones only while just approved", () => {
    const proposals = [
      proposal("pending", "12:00", { status: "pending" }),
      proposal("voting", "12:30"),
      proposal("just-approved", "14:00", { status: "approved" }),
      proposal("approved-earlier", "15:00", { status: "approved" }),
      proposal("rejected", "16:00", { status: "rejected" }),
      proposal("withdrawn", "16:30", { status: "withdrawn" }),
      proposal("expired", "17:00", { status: "expired" }),
    ];
    expect(order(dayTimeline(day, proposals, 2, new Set(["just-approved"])))).toEqual([
      "breakfast",
      "museum",
      "+pending",
      "+voting",
      "+just-approved",
      "dinner",
    ]);
  });

  it("leaves out proposals for other days", () => {
    const proposals = [proposal("day-one", "09:00", { target_day: 1 }), proposal("day-three", "09:00", { target_day: 3 })];
    expect(order(dayTimeline(day, proposals, 2, none))).toEqual(["breakfast", "museum", "dinner"]);
  });

  it("hands back the proposals themselves", () => {
    const brunch = proposal("brunch", "09:00");
    expect(dayTimeline(day, [brunch], 2, none)[1].data).toBe(brunch);
  });
});
