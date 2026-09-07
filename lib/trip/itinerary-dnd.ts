/**
 * Cross-day drag-and-drop for the trip editor — the pure part.
 *
 * Before this module, /trips/[id] created one DndContext PER DAY, so an
 * activity could only be reordered inside its own day: dragging it towards
 * another day silently snapped back, and the only way across was a hidden
 * 32px icon. Now a single context spans every day and three kinds of
 * droppable exist:
 *
 *   - an activity card        (id = the activity id)
 *   - a day's activity list   (id = `day-drop:<dayNumber>`)  → drop at the end
 *   - a day's header          (id = `day-header:<dayNumber>`) → drop at the start
 *
 * `applyMove` is called on every drag-over step (live preview) and once more
 * on drop, so what the user sees while dragging is exactly what gets saved.
 * It returns the SAME array reference when nothing changes, which lets the
 * caller skip state updates and undo entries for no-op steps.
 *
 * No React, no dnd-kit imports here — unit-tested on its own.
 */
import type { ItineraryDay } from "@/types";

export const DAY_DROP_PREFIX = "day-drop:";
export const DAY_HEADER_PREFIX = "day-header:";

export function dayDropId(dayNumber: number): string {
  return `${DAY_DROP_PREFIX}${dayNumber}`;
}

export function dayHeaderId(dayNumber: number): string {
  return `${DAY_HEADER_PREFIX}${dayNumber}`;
}

export type DropTarget =
  | { kind: "activity"; activityId: string }
  | { kind: "day"; dayNumber: number }
  | { kind: "header"; dayNumber: number };

export function parseDropId(id: string | number): DropTarget {
  const s = String(id);
  if (s.startsWith(DAY_HEADER_PREFIX)) {
    return { kind: "header", dayNumber: Number(s.slice(DAY_HEADER_PREFIX.length)) };
  }
  if (s.startsWith(DAY_DROP_PREFIX)) {
    return { kind: "day", dayNumber: Number(s.slice(DAY_DROP_PREFIX.length)) };
  }
  return { kind: "activity", activityId: s };
}

export interface ActivityLocation {
  dayIndex: number;
  index: number;
}

export function locateActivity(itinerary: ItineraryDay[], activityId: string): ActivityLocation | null {
  for (let dayIndex = 0; dayIndex < itinerary.length; dayIndex++) {
    const index = itinerary[dayIndex].activities.findIndex((a) => a.id === activityId);
    if (index !== -1) return { dayIndex, index };
  }
  return null;
}

function dayIndexByNumber(itinerary: ItineraryDay[], dayNumber: number): number {
  return itinerary.findIndex((d) => d.day_number === dayNumber);
}

/**
 * Where a drop target lands for the active activity: which day, and at what
 * index in that day's list. `null` when the target is unknown or is the
 * active activity itself.
 */
export function resolveTarget(
  itinerary: ItineraryDay[],
  target: DropTarget,
  activeId: string,
  opts: { after?: boolean } = {},
): ActivityLocation | null {
  switch (target.kind) {
    case "header": {
      const dayIndex = dayIndexByNumber(itinerary, target.dayNumber);
      return dayIndex === -1 ? null : { dayIndex, index: 0 };
    }
    case "day": {
      const dayIndex = dayIndexByNumber(itinerary, target.dayNumber);
      if (dayIndex === -1) return null;
      const activities = itinerary[dayIndex].activities;
      // Hovering the list's empty space (typically below the last card) means
      // "at the end". If the active card is already in this day, the end is
      // the last slot.
      const alreadyHere = activities.some((a) => a.id === activeId);
      return { dayIndex, index: alreadyHere ? Math.max(0, activities.length - 1) : activities.length };
    }
    case "activity": {
      if (target.activityId === activeId) return null;
      const loc = locateActivity(itinerary, target.activityId);
      if (!loc) return null;
      // Crossing into another day: land before the hovered card, or after it
      // when the pointer is in its lower half (the caller decides `after`).
      const from = locateActivity(itinerary, activeId);
      const crossing = !from || from.dayIndex !== loc.dayIndex;
      return crossing && opts.after ? { dayIndex: loc.dayIndex, index: loc.index + 1 } : loc;
    }
  }
}

/**
 * True when the drop target is in the active activity's own day. Within a
 * day, dnd-kit's sortable strategy animates the reorder itself and the
 * final order is committed on drop; live-applying it as well would shift
 * cards twice. Cross-day steps are the ones previewed live.
 */
export function isSameDayTarget(itinerary: ItineraryDay[], activeId: string, overId: string | number): boolean {
  const from = locateActivity(itinerary, activeId);
  if (!from) return false;
  const target = parseDropId(overId);
  const dayIndex =
    target.kind === "activity"
      ? (locateActivity(itinerary, target.activityId)?.dayIndex ?? -1)
      : dayIndexByNumber(itinerary, target.dayNumber);
  return dayIndex === from.dayIndex;
}

function moveWithin<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Put the active activity at the drop target's position. Same day →
 * reorder; another day → remove from the source and insert into the target.
 * Returns the same array reference when nothing changes.
 */
export function applyMove(
  itinerary: ItineraryDay[],
  activeId: string,
  overId: string | number,
  opts: { after?: boolean } = {},
): ItineraryDay[] {
  const from = locateActivity(itinerary, activeId);
  if (!from) return itinerary;

  const target = resolveTarget(itinerary, parseDropId(overId), activeId, opts);
  if (!target) return itinerary;

  if (target.dayIndex === from.dayIndex) {
    if (target.index === from.index) return itinerary;
    return itinerary.map((day, d) =>
      d === from.dayIndex ? { ...day, activities: moveWithin(day.activities, from.index, target.index) } : day,
    );
  }

  const activity = itinerary[from.dayIndex].activities[from.index];
  return itinerary.map((day, d) => {
    if (d === from.dayIndex) {
      return { ...day, activities: day.activities.filter((_, i) => i !== from.index) };
    }
    if (d === target.dayIndex) {
      const activities = day.activities.slice();
      activities.splice(Math.min(target.index, activities.length), 0, activity);
      return { ...day, activities };
    }
    return day;
  });
}

/** The days an activity sits in before and after a drag, for the commit step. */
export function describeMove(
  before: ItineraryDay[],
  after: ItineraryDay[],
  activityId: string,
): { sourceDayIndex: number; targetDayIndex: number; crossedDays: boolean } | null {
  const from = locateActivity(before, activityId);
  const to = locateActivity(after, activityId);
  if (!from || !to) return null;
  return { sourceDayIndex: from.dayIndex, targetDayIndex: to.dayIndex, crossedDays: from.dayIndex !== to.dayIndex };
}
