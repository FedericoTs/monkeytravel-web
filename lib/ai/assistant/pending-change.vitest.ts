import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { pendingChangeFor } from "./pending-change";

/**
 * What the trip assistant hands the chat to confirm: a day added at the end,
 * or days replaced (a pasted draft, or the edit engine's), with the end date
 * a change moves and the one an undo puts back.
 */

const day = (n: number) => ({ day_number: n, date: `2027-03-1${n}`, activities: [] }) as unknown as ItineraryDay;
const context = { failed: false, previousEndDate: "2027-03-13", unmappedDayNumbers: [] as number[], engineSummary: null };

describe("the change a turn prepared", () => {
  it("is a day added at the end, with the end date it moves and the one an undo restores", () => {
    expect(pendingChangeFor({ type: "add_day", applied: false, newDay: day(4), dayNumber: 4, newEndDate: "2027-03-14" }, context)).toEqual({
      type: "add_day",
      day: day(4),
      dayNumber: 4,
      newEndDate: "2027-03-14",
      previousEndDate: "2027-03-13",
      reason: "New day appended from your request",
    });
  });

  it("is a pasted draft's days, with the days it could not read", () => {
    const change = pendingChangeFor(
      { type: "apply_draft", applied: false, revisedDays: [day(1), day(3)] },
      { ...context, unmappedDayNumbers: [2] }
    );
    expect(change).toEqual({
      type: "apply_draft",
      days: [day(1), day(3)],
      changedDayNumbers: [1, 3],
      unmappedDayNumbers: [2],
      reason: "Mapped from your pasted draft",
    });
  });

  it("is the edit engine's days, its summary as the reason, and the end date when it adds days", () => {
    const action = { type: "apply_draft" as const, applied: false, revisedDays: [day(3), day(4)], newEndDate: "2027-03-14" };
    expect(pendingChangeFor(action, { ...context, engineSummary: "Day 4: Howth." })).toMatchObject({
      reason: "Day 4: Howth.",
      newEndDate: "2027-03-14",
      previousEndDate: "2027-03-13",
    });
    expect(pendingChangeFor(action, { ...context, engineSummary: "" })?.reason).toBeUndefined();
  });

  it("is nothing when nothing was prepared, or preparing it failed", () => {
    expect(pendingChangeFor(undefined, context)).toBeNull();
    expect(pendingChangeFor({ type: "add_day", applied: false, newDay: day(4) }, { ...context, failed: true })).toBeNull();
    expect(pendingChangeFor({ type: "add_day", applied: false }, context)).toBeNull();
    expect(pendingChangeFor({ type: "replace_activity", applied: false }, context)).toBeNull();
  });
});
