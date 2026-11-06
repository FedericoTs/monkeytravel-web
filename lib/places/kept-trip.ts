import type { Activity, ItineraryDay } from "@/types";

/**
 * A kept trip's places to eat are looked up on Google Maps once, when its
 * owner first opens it (lib/places/check-kept-trip.ts), rather than for each
 * plan made: most plans are never kept. What the trip page and the server
 * share of that check: whether it is due, what it changed, and what the page
 * says of it. Client-safe.
 */

/** trip_meta's stamp of the check: when it was made. */
export const PLACES_TO_EAT_CHECKED_AT = "places_to_eat_checked_at";
/** trip_meta's record of what the check found: places looked up, and places changed. */
export const PLACES_TO_EAT_RESULT = "places_to_eat_result";

/**
 * Whether a trip's places to eat are still to be looked up: it was not checked,
 * and has not ended before `today` (YYYY-MM-DD).
 */
export function placesToEatCheckDue(trip: { endDate?: string | null; meta?: unknown }, today: string): boolean {
  const meta = (trip.meta ?? {}) as Record<string, unknown>;
  return !meta[PLACES_TO_EAT_CHECKED_AT] && !(trip.endDate && trip.endDate < today);
}

/** What the trip page says of the check. */
export interface PlacesToEatNote {
  checkedAt: string;
  /** Places Google answered for. */
  checked: number;
  /** Places replaced or left out. */
  changed: number;
}

/** The note in a trip's trip_meta: none before the check, or when it looked up nothing. */
export function placesToEatNote(meta: unknown): PlacesToEatNote | null {
  const m = (meta ?? {}) as Record<string, unknown>;
  const checkedAt = m[PLACES_TO_EAT_CHECKED_AT];
  const result = m[PLACES_TO_EAT_RESULT] as { checked?: unknown; changed?: unknown } | undefined;
  if (typeof checkedAt !== "string" || typeof result?.checked !== "number" || result.checked <= 0) return null;
  return { checkedAt, checked: result.checked, changed: typeof result.changed === "number" ? result.changed : 0 };
}

/**
 * What the check did to one of the trip's places to eat: put an open place in
 * its stead, left it out (Maps has it closed and no open one was found), or
 * kept it marked unverified (Maps doesn't have it).
 */
export interface PlaceChange {
  /** The day the place is on. */
  day: number;
  /** The activity's id, and its name: a change applies only while both still match. */
  id?: string;
  name: string;
  /** The open place in its stead; null when it is left out or kept unverified. */
  to: Activity | null;
  unverified?: true;
}

/**
 * The itinerary with the changes made, each once and only where its place is
 * still there as it was.
 */
export function applyPlaceChanges(itinerary: ItineraryDay[], changes: PlaceChange[]): ItineraryDay[] {
  if (changes.length === 0) return itinerary;
  return itinerary.map((day) => {
    const onDay = changes.filter((c) => c.day === day.day_number);
    if (onDay.length === 0) return day;
    const activities: Activity[] = [];
    for (const activity of day.activities ?? []) {
      const at = onDay.findIndex((c) => activity.name === c.name && (c.id === undefined || activity.id === c.id));
      if (at === -1) {
        activities.push(activity);
        continue;
      }
      const [change] = onDay.splice(at, 1);
      if (change.to) activities.push(change.to);
      else if (change.unverified) activities.push({ ...activity, unverified: true });
    }
    return { ...day, activities };
  });
}
