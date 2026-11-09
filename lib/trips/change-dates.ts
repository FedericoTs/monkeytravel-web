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
import { addIsoDaysOrThrow, isValidIsoDate, tripSpanDays } from "@/lib/dates/iso-date";
import type { AssistantDayEdit } from "@/lib/trips/day-edit-merge";
import type { GeneratedItinerary, ItineraryDay } from "@/types";

export type DateChange =
  | { kind: "invalid"; reason: "dates" | "order" | "tooLong" }
  | { kind: "same"; length: number }
  | { kind: "shorter"; length: number; removedFrom: number }
  | { kind: "longer"; length: number; addedFrom: number };

/** Days from start to end, both included; null when either date is not a real day. */
export function inclusiveDays(start: string, end: string): number | null {
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  return tripSpanDays(start, end);
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

/**
 * A saved trip's days on new dates: moved to `start`, the first ones kept for
 * a shorter trip, and for a longer one, new empty days on the dates that
 * follow, in the city the trip ends in, for the traveller to fill (or to ask
 * the assistant for). Null when the dates don't make a trip.
 */
export function savedTripOnNewDates(days: ItineraryDay[], start: string, end: string, maxDays: number): ItineraryDay[] | null {
  const change = planDateChange(days.length, start, end, maxDays);
  if (change.kind === "invalid") return null;
  const moved = moveItineraryDates(days, start, change.length);
  if (change.kind !== "longer") return moved;
  const city = days[days.length - 1]?.city;
  const added = Array.from({ length: change.length - days.length }, (_, i): ItineraryDay => ({
    day_number: days.length + 1 + i,
    date: addIsoDaysOrThrow(start, days.length + i),
    activities: [],
    ...(city ? { city } : {}),
  }));
  return [...moved, ...added];
}

/**
 * The assistant's ask for a longer trip: the new days only, at the end and
 * planned like the others, with the plan as it stands on the new dates and
 * the dates it covers so far.
 */
export function extraDaysAsk({
  itinerary,
  moved,
  start,
  current,
  length,
  tripTitle,
  locale,
}: {
  itinerary: GeneratedItinerary;
  /** The plan's days on the new dates. */
  moved: ItineraryDay[];
  start: string;
  /** Days the plan has now. */
  current: number;
  /** Days the trip will have. */
  length: number;
  tripTitle: string;
  /** The page's language, for a plan without its own. */
  locale: string;
}) {
  const extra = length - current;
  return {
    message: `Add ${extra} more ${extra === 1 ? "day" : "days"} at the end of the trip (${
      extra === 1 ? `Day ${current + 1}` : `Days ${current + 1} to ${length}`
    }), planned like the other days, and set trip_length to ${length}. Leave the existing days as they are.`,
    destination: `${itinerary.destination.name}, ${itinerary.destination.country}`,
    tripTitle,
    days: moved,
    startDate: start,
    endDate: addIsoDaysOrThrow(start, current - 1),
    locale: itinerary.language ?? locale,
    history: [],
  };
}

/**
 * The new days in the assistant's reply, and how far they take the trip: only
 * days after the plan's and within the trip, since the plan the traveller
 * already has is not the ask.
 */
export function extraDaysFrom(
  reply: unknown,
  current: number,
  length: number
): { planned: number; newDays: AssistantDayEdit[] } {
  const body = reply as { data?: unknown } | null | undefined;
  const payload = (body?.data ?? body ?? {}) as { tripLength?: unknown; edits?: unknown };
  const planned = Math.min(typeof payload.tripLength === "number" ? payload.tripLength : 0, length);
  const newDays = (Array.isArray(payload.edits) ? (payload.edits as AssistantDayEdit[]) : []).filter(
    (e) => e && e.day_number > current && e.day_number <= planned
  );
  return { planned, newDays };
}
