import { describe, expect, it } from "vitest";
import type { EditableActivityCardProps } from "./EditableActivityCard";
import { sameSortableCard } from "./SortableActivityCard";

const props = (extra: Partial<EditableActivityCardProps> = {}) =>
  ({
    activity: { id: "a1", name: "Kiyomizu-dera", start_time: "14:30", duration_minutes: 90 },
    index: 0,
    isEditMode: true,
    isRegenerating: false,
    currentDayIndex: 0,
    dayOptions: [{ dayNumber: 1, count: 3 }],
    ...extra,
  }) as unknown as EditableActivityCardProps;

describe("sameSortableCard", () => {
  it("skips the render when nothing the card shows or does has changed", () => {
    const before = props();
    expect(sameSortableCard(before, { ...before, onDelete: () => {} })).toBe(true);
  });

  // A stop added elsewhere leaves this card's own fields as they were, but its
  // actions and the move sheet's counts belong to the plan as it is now.
  it("renders again when a day of the plan changed", () => {
    const before = props();
    expect(sameSortableCard(before, props({ dayOptions: [{ dayNumber: 1, count: 4 }] } as never))).toBe(false);
  });

  it("renders again when the card's own activity changed", () => {
    const before = props();
    expect(sameSortableCard(before, props({ activity: { ...before.activity, start_time: "15:00" } }))).toBe(false);
  });
});
