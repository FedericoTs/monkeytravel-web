/**
 * Places shut for long works that plans still send people to: the model learned
 * them open, or ignores the closure. Each is listed for its city and the days it
 * is shut, with the official page that says so. A trip whose every day falls in
 * that span is told not to plan it, and a stop that is it is taken out of the
 * plan, a cached plan's included. Look-alikes (another city's branch, a separate
 * venue that is open) are never taken for it.
 */
import type { TripCreationParams } from "@/types";

export type LongClosure = {
  /** What a plan calls it. */
  names: RegExp;
  /** Names it shares with places that are open. */
  notNames?: RegExp;
  /** The trip's destination, as the traveller wrote it. */
  city: RegExp;
  /** Shut from this day (YYYY-MM-DD) to the day before `until`. */
  from: string;
  until: string;
  /** How the planner is told. */
  label: string;
  /** The official page with the dates. */
  source: string;
};

export const LONG_CLOSURES: LongClosure[] = [
  {
    names: /\b(?:centre|center|centro)\s+(?:georges[\s-]+)?pompidou\b|\bpompidou\s+(?:centre|center)\b|\bmus[ée]e\s+national\s+d.art\s+moderne\b/i,
    notNames: /metz|m[aá]laga|shanghai|bruxelles|brussels|kanal|seoul|jersey/i,
    city: /\bparis\b|\bparigi\b|\bpar[ií]s\b/i,
    from: "2025-09-22",
    until: "2030-01-01",
    label: "Centre Pompidou (closed for renovation until 2030)",
    source: "https://centrepompidou.fr/en/temporary-closure-for-works/renovation-programme",
  },
  {
    names: /\bpergamon\s*-?\s*museum\b|\bpergamonmuseum\b|\bmuse[ou]\s+(?:di\s+|de\s+|do\s+)?p[eé]rgamo\b/i,
    notNames: /panorama/i,
    city: /\bberl[ií]n[oa]?\b|\bberlim\b/i,
    from: "2023-10-23",
    until: "2027-06-04",
    label: "Pergamonmuseum (closed for renovation until 4 June 2027)",
    source: "https://www.smb.museum/en/whats-new/detail/the-pergamonmuseum-returns-opening-on-june-4th-2027/",
  },
  {
    // Shut since 1 September 2026 "as we prepare for our next chapter", back in 2027 with no date yet: listed to
    // the end of 2026, the part that is certain.
    names: /\bmuseum of the future\b|\bmuseo del futuro\b|\bmuseu do futuro\b|متحف المستقبل/i,
    city: /\bdubai\b|\bdub[aá]i\b|دبي/i,
    from: "2026-09-01",
    until: "2027-01-01",
    label: "Museum of the Future (temporarily closed, reopening in 2027)",
    source: "https://museumofthefuture.ae/en",
  },
];

type Trip = Pick<TripCreationParams, "destination" | "startDate" | "endDate">;

/** The closures that cover every day of a trip to this destination. */
export function closuresFor({ destination, startDate, endDate }: Trip): LongClosure[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
  return LONG_CLOSURES.filter((c) => c.city.test(destination) && startDate >= c.from && endDate < c.until);
}

/** Whether a stop's name is one of these places. */
export function isClosedPlace(name: string | undefined, closures: LongClosure[]): boolean {
  return Boolean(name) && closures.some((c) => c.names.test(name!) && !c.notNames?.test(name!));
}

/** The line that tells the planner, or "" when nothing on the list is shut on the trip. */
export function longClosuresLine(trip: Trip): string {
  const closures = closuresFor(trip);
  return closures.length ? `Closed for the whole trip, never plan a visit: ${closures.map((c) => c.label).join("; ")}.` : "";
}

/** The plan without its stops that are a place shut for the whole trip, and how many went. */
export function withoutLongClosures<T extends { days: Array<{ activities?: Array<{ name?: string }> }> }>(
  itinerary: T,
  trip: Trip
): { itinerary: T; removed: number } {
  const closures = closuresFor(trip);
  if (closures.length === 0) return { itinerary, removed: 0 };
  let removed = 0;
  const days = itinerary.days.map((day) => {
    const kept = (day.activities ?? []).filter((stop) => !isClosedPlace(stop.name, closures));
    removed += (day.activities ?? []).length - kept.length;
    return kept.length === (day.activities ?? []).length ? day : { ...day, activities: kept };
  });
  return removed > 0 ? { itinerary: { ...itinerary, days }, removed } : { itinerary, removed: 0 };
}
