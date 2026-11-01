/**
 * Changing a generated trip's dates without starting over.
 *
 * "Wrong dates" is the top reason people give for Start Over: the plan is
 * fine, the dates are not, and without this the only way to fix them is to
 * throw the plan away. Many tap "I'm flexible", which pencils in dates for
 * them.
 *
 * The plan follows the new dates:
 * - same length: every day moves, nothing else changes;
 * - shorter: the first days stay, the last ones go;
 * - longer: the days move, and the new ones are planned by the assistant.
 */
import { addIsoDaysOrThrow, isValidIsoDate } from "@/lib/dates/iso-date";
import type { ItineraryDay } from "@/types";

export type DateChange =
  | { kind: "invalid"; reason: "dates" | "order" | "tooLong" }
  | { kind: "same"; length: number }
  | { kind: "shorter"; length: number; removedFrom: number }
  | { kind: "longer"; length: number; addedFrom: number };

/** Days from start to end, both included; null when either date is not a real day. */
export function inclusiveDays(start: string, end: string): number | null {
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** What a new date range does to a plan of `currentDays` days. */
export function planDateChange(currentDays: number, start: string, end: string, maxDays: number): DateChange {
  const length = inclusiveDays(start, end);
  if (length === null) return { kind: "invalid", reason: "dates" };
  if (length < 1) return { kind: "invalid", reason: "order" };
  if (length > maxDays) return { kind: "invalid", reason: "tooLong" };
  if (length === currentDays) return { kind: "same", length };
  if (length < currentDays) return { kind: "shorter", length, removedFrom: length + 1 };
  return { kind: "longer", length, addedFrom: currentDays + 1 };
}

/**
 * The plan moved to `start`, kept to at most `length` days. Days are never
 * added here: a new day needs planning (the assistant does that).
 */
export function moveItineraryDates(days: ItineraryDay[], start: string, length: number): ItineraryDay[] {
  return days.slice(0, Math.max(0, length)).map((d, i) => ({
    ...d,
    day_number: i + 1,
    date: addIsoDaysOrThrow(start, i),
  }));
}
