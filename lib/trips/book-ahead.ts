import type { ItineraryDay } from "@/types";

/**
 * A trip's "Book ahead" list: the stops its plan marks as needing a booking,
 * day by day in the plan's order, each with the link to book from: the stop's
 * official site, else its booking page, https only.
 */
export interface BookAheadStop {
  id: string;
  name: string;
  dayNumber: number;
  date?: string;
  startTime?: string;
  link?: string;
}

/** The ticks a trip keeps at most (trip_meta.booked_ids). */
export const BOOKED_IDS_MAX = 200;

function httpsLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function bookAheadStops(days: ItineraryDay[]): BookAheadStop[] {
  const seen = new Set<string>();
  const stops: BookAheadStop[] = [];
  for (const day of [...days].sort((a, b) => a.day_number - b.day_number)) {
    for (const activity of Array.isArray(day.activities) ? day.activities : []) {
      if (!activity || activity.booking_required !== true || !activity.id || seen.has(activity.id)) continue;
      seen.add(activity.id);
      const link = httpsLink(activity.official_website) ?? httpsLink(activity.booking_url);
      stops.push({
        id: activity.id,
        name: activity.name,
        dayNumber: day.day_number,
        ...(day.date ? { date: day.date } : {}),
        ...(activity.start_time ? { startTime: activity.start_time } : {}),
        ...(link ? { link } : {}),
      });
    }
  }
  return stops;
}

/** The stops ticked as booked, from a trip's trip_meta. */
export function readBookedIds(meta: unknown): string[] {
  const ids = meta && typeof meta === "object" ? (meta as { booked_ids?: unknown }).booked_ids : undefined;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))].slice(0, BOOKED_IDS_MAX);
}
