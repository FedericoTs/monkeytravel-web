/**
 * The Waiting Room: the signed-in home for someone with a trip coming. The trip
 * is the hero, with a countdown, and what sits under it changes with the distance
 * to departure (DESIGN.md, "The signed-in home").
 *
 * 90% of accounts see it. The other 10% are a holdout and a way to compare, not
 * an A/B test: volumes are too low for one. WAITING_ROOM=off turns it off.
 */
import { tripDateOnly } from "@/lib/trip/live";
import { stillPencilled } from "@/lib/trips/pencilled-dates";

export type WaitingStage = "far" | "weeks" | "days" | "during";

export function waitingStage(daysToGo: number): WaitingStage {
  if (daysToGo <= 0) return "during";
  if (daysToGo < 7) return "days";
  if (daysToGo <= 30) return "weeks";
  return "far";
}

interface HomeTripFields {
  start_date: string;
  end_date: string;
  status: string;
  is_archived?: boolean | null;
}

/** The trip the home is about: one under way, or else the next to start. */
export function homeTrip<T extends HomeTripFields>(trips: readonly T[], today: string): T | null {
  const dated = trips.filter((t) => !t.is_archived && t.status !== "cancelled" && t.start_date && t.end_date);
  const soonest = (list: T[]) => [...list].sort((a, b) => tripDateOnly(a.start_date).localeCompare(tripDateOnly(b.start_date)))[0] ?? null;
  return (
    soonest(dated.filter((t) => tripDateOnly(t.start_date) <= today && tripDateOnly(t.end_date) >= today)) ??
    soonest(dated.filter((t) => tripDateOnly(t.start_date) > today))
  );
}

/** Which side of the holdout an account is on. The same account always lands on the same side. */
export function inWaitingRoom(userId: string): boolean {
  let hash = 2166136261;
  for (const char of userId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 10 !== 0;
}

export interface WaitingRoomTrip {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  /** The trip's dates are a placeholder, so nothing counts down to them. */
  pencilled: boolean;
  highlights: string[];
  packing: string[];
  firstStop: string | null;
}

const strings = (value: unknown, count: number) =>
  (Array.isArray(value) ? value : []).filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, count);

/** What the home's read of the trip gave, down to what the page shows. A failed read leaves it bare. */
export function waitingRoomTrip(
  trip: { id: string; title: string; start_date: string; end_date: string },
  read: { highlights?: unknown; packing?: unknown; pencilled?: unknown; day1?: unknown } | null,
): WaitingRoomTrip {
  const startDate = tripDateOnly(trip.start_date);
  const endDate = tripDateOnly(trip.end_date);
  const activities = (read?.day1 as { activities?: unknown } | null | undefined)?.activities;
  const first = Array.isArray(activities) ? (activities[0] as { name?: unknown } | null | undefined)?.name : null;
  return {
    id: trip.id,
    title: trip.title.replace(/\s+Trip\s*$/i, "").trim() || trip.title,
    startDate,
    endDate,
    pencilled: stillPencilled(read?.pencilled, startDate, endDate),
    highlights: strings(read?.highlights, 3),
    packing: strings(read?.packing, 3),
    firstStop: typeof first === "string" && first.trim() ? first.trim() : null,
  };
}
