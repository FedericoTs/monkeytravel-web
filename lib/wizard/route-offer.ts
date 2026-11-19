/**
 * Step 1's route offer: a destination typed as a whole country or region
 * ("Thailand", 14 days) gets the bases most travellers use, from
 * /api/wizard/route-plan, to take as a trip through several cities. Client-safe.
 */
import type { RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import { tripSpanDays } from "@/lib/dates/iso-date";
import { MAX_TRIP_DAYS } from "@/lib/trips/request-limits";

/** Shorter trips stay in one place: a route needs a few days in each base. */
export const ROUTE_OFFER_MIN_DAYS = 5;

/**
 * The place and length to ask a route for, or null when step 1 offers none: a
 * place picked from the suggestions (a city, a town or an island), a trip
 * through several cities already, a destination step 1 won't take, no dates
 * yet, or a trip too short to move.
 */
export function routeOfferAsk(state: {
  /** Multi-city planning is switched on for the site. */
  enabled: boolean;
  multiCityMode: boolean;
  destination: string;
  /** step 1's own check of the destination: null when it would go on. */
  destinationProblem: string | null;
  /** The destination is the text a picked suggestion put in the field. */
  picked: boolean;
  startDate: string;
  endDate: string;
}): { place: string; days: number } | null {
  if (!state.enabled || state.multiCityMode || state.picked || state.destinationProblem !== null) return null;
  const place = state.destination.replace(/\s+/g, " ").trim();
  if (!place || !state.startDate || !state.endDate) return null;
  const days = tripSpanDays(state.startDate, state.endDate);
  if (!(days >= ROUTE_OFFER_MIN_DAYS && days <= MAX_TRIP_DAYS)) return null;
  return { place, days };
}

/** How long the page waits for a route before offering none. */
export const ROUTE_TIMEOUT_MS = 10_000;

/**
 * The bases for the place, or none when there's no route to offer or the
 * question failed. `signal` ends it early (the place or dates changed); the
 * caller times it out with the same signal.
 */
export async function fetchRouteOffer(
  ask: { place: string; days: number; startDate: string; locale: string },
  signal: AbortSignal
): Promise<RouteStop[]> {
  try {
    const response = await fetch("/api/wizard/route-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ask),
      signal,
    });
    if (!response.ok) return [];
    const route = ((await response.json()) as { route?: unknown }).route;
    if (!Array.isArray(route)) return [];
    return route.filter(
      (r): r is RouteStop => !!r && typeof r.city === "string" && r.city.trim() !== "" && Number.isInteger(r.nights) && r.nights > 0
    );
  } catch {
    return [];
  }
}
