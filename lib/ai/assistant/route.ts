import { MAX_CITIES } from "@/lib/ai/multi-city-core";
import {
  DESTINATION_ALLOWLIST,
  DESTINATION_MAX_LENGTH,
  DESTINATION_MIN_LENGTH,
  ROUTE_STOP_NIGHTS_MAX,
} from "@/lib/trips/request-limits";
import { isSameDestination } from "@/lib/trips/sameDestination";
import { placeLabel, type TripPlace } from "./elsewhere";

/**
 * The trip's route, told anew: "we go back to Lisbon on the 27th", "Lisbon,
 * then Porto, then Lisbon again". The wizard's assistant offers the cities in
 * order with their days, and the page plans the trip anew along them for the
 * same dates, as it plans another place (elsewhere.ts), rather than the
 * assistant moving days between cities under the old route's title, map and
 * stays. Client-safe.
 */
export interface RouteStop extends TripPlace {
  days: number;
}

/** The stops in order, as the traveller reads them: "Lisboa → Porto → Lisboa". */
export function routeLabel(stops: RouteStop[]): string {
  return stops.map((s) => s.name).join(" → ");
}

/**
 * The route as the wizard's multi-city rows: a city's name, as the request
 * reader fills them (lib/wizard/request-reading.ts), and its days ("nights").
 */
export function routeRows(stops: RouteStop[]): Array<{ city: string; nights: number }> {
  return stops.map((s) => ({ city: s.name, nights: s.days }));
}

/**
 * The plan's stays in order, each with its days: three days in Lisboa, then two in Porto, read [Lisboa 3, Porto 2].
 * A day with no city counts in the stay before it.
 */
export function planRoute(days: Array<{ city?: string }>): Array<{ name: string; days: number }> {
  const out: Array<{ name: string; days: number }> = [];
  for (const d of days) {
    const city = (d.city ?? "").split(",")[0].trim();
    const last = out[out.length - 1];
    if (last && (!city || isSameDestination(last.name, city))) last.days++;
    else if (city) out.push({ name: city, days: 1 });
  }
  return out;
}

/**
 * The route a reply offers that the page can plan, or none: 2 to MAX_CITIES
 * stops the destination field would accept, one after another in different
 * places, each 1 to ROUTE_STOP_NIGHTS_MAX days, the days adding up to the trip's
 * `length`, and not the plan's own route (`current`): the same places with the same days. Days moved from one of
 * its places to another ("back to Edinburgh a day earlier") are a new route.
 */
export function readRoute(raw: unknown, length: number, current: Array<{ name: string; days: number }>): RouteStop[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_CITIES) return [];
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const stops: RouteStop[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return [];
    const o = item as { name?: unknown; country?: unknown; days?: unknown };
    const stop = { name: text(o.name), country: text(o.country), days: typeof o.days === "number" ? Math.round(o.days) : NaN };
    const label = placeLabel(stop);
    if (stop.name.length < DESTINATION_MIN_LENGTH || label.length > DESTINATION_MAX_LENGTH || !DESTINATION_ALLOWLIST.test(label)) return [];
    if (!(stop.days >= 1 && stop.days <= ROUTE_STOP_NIGHTS_MAX)) return [];
    if (stops.length > 0 && isSameDestination(stops[stops.length - 1].name, stop.name)) return [];
    stops.push(stop);
  }
  if (stops.reduce((sum, s) => sum + s.days, 0) !== length) return [];
  const same = current.length === stops.length && stops.every((s, i) => isSameDestination(s.name, current[i].name) && s.days === current[i].days);
  return same ? [] : stops;
}
