/**
 * Multi-city itinerary merge — PURE core (no I/O, no Gemini imports).
 *
 * Phase 1 of the multi-city wedge (docs/MULTI_CITY_PLAN.md), reliability-first
 * architecture: each city is generated INDEPENDENTLY (small single-city prompt,
 * far less truncation risk, and each city keeps its own coordinates), then the
 * per-city results are stitched into ONE itinerary here.
 *
 * This module is deliberately dependency-free (types only) so it unit-tests
 * without pulling in lib/gemini (which needs runtime env). The orchestrator that
 * actually calls Gemini lives in lib/ai/multi-city.ts.
 */
import type { GeneratedItinerary, ItineraryDay } from "@/types";
import { buildTransferActivity, dayWithTransfer } from "./transfer-legs";
import { flightLink, hotelLinks } from "./booking-links";
import { addIsoDays } from "@/lib/dates/iso-date";
import { haversineKm } from "@/lib/map/geo";
import { isRealPoint } from "@/lib/trip/placeholder-point";

/** Max cities per trip in v1 (caps complexity + generation quality). */
export const MAX_CITIES = 5;

/** One leg of a multi-city trip: a city + how many nights/days it gets. */
export interface CityLeg {
  city: string;
  nights: number;
  country?: string;
}

export class MultiCityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultiCityError";
  }
}

/** "A" · "A & B" · "A, B & C" — the human label for a multi-city route. */
export function joinCities(cities: string[]): string {
  const c = cities.map((s) => s.trim()).filter(Boolean);
  if (c.length === 0) return "";
  if (c.length === 1) return c[0];
  if (c.length === 2) return `${c[0]} & ${c[1]}`;
  return `${c.slice(0, -1).join(", ")} & ${c[c.length - 1]}`;
}

// Inverse of joinCities. Only labels containing " & " are treated as routes —
// plain "City, Country" freetext stays single. Lives here (next to its
// inverse) since the P4 fix: the previous copy in lib/trips/persistTrip.ts
// split on the pattern  s*(?:,|&)s*  — missing backslashes on \s, so literal
// "s" characters around separators were eaten and "Paris, Rome & Milan"
// persisted trip_meta.cities as ["Pari", "Rome", "Milan"].
// (Line comments on purpose: the buggy pattern contains "*/" and would
// terminate a block comment early — exactly the bug this note documents.)
export function splitCities(label: string): string[] {
  if (!label.includes(" & ")) return [label.trim()].filter(Boolean);
  return label
    .split(/\s*(?:,|&)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Add `days` to a YYYY-MM-DD date, or throw when the date is not real. */
export function addDaysISO(startISO: string, days: number): string {
  const shifted = addIsoDays(startISO, days);
  if (shifted === null) {
    throw new MultiCityError(`addDaysISO: invalid date "${startISO}"`);
  }
  return shifted;
}

function dedupeStrings(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

/**
 * Validate the legs of a multi-city trip. Throws MultiCityError on the first
 * problem. `expectedTotalNights` (when given) must equal the summed nights —
 * i.e. the per-city nights cover the whole trip with no gap/overlap.
 */
export function validateLegs(legs: CityLeg[], expectedTotalNights?: number): void {
  if (legs.length < 1) throw new MultiCityError("a multi-city trip needs at least one city");
  if (legs.length > MAX_CITIES) {
    throw new MultiCityError(`a trip can have at most ${MAX_CITIES} cities (got ${legs.length})`);
  }
  for (const leg of legs) {
    if (!leg.city || !leg.city.trim()) {
      throw new MultiCityError("every city must have a name");
    }
    if (!Number.isInteger(leg.nights) || leg.nights < 1) {
      throw new MultiCityError(`"${leg.city}" must have at least 1 night`);
    }
  }
  const total = legs.reduce((s, l) => s + l.nights, 0);
  if (expectedTotalNights !== undefined && total !== expectedTotalNights) {
    throw new MultiCityError(
      `city nights (${total}) must sum to the trip length (${expectedTotalNights})`
    );
  }
}

/** Places this close, directly or through others, are in one area. */
const SAME_AREA_KM = 100;

type Point = { lat: number; lng: number };

/** The area each point is in, as an index: points chained by SAME_AREA_KM share one. */
function areasOf(points: Point[]): number[] {
  const area = points.map((_, i) => i);
  const root = (i: number): number => (area[i] === i ? i : (area[i] = root(area[i])));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (haversineKm(points[i], points[j]) <= SAME_AREA_KM) area[root(i)] = root(j);
    }
  }
  return points.map((_, i) => root(i));
}

/**
 * Each city's area: a different one for each, the way that puts the most of the
 * cities' places at home. A city may have none, and then keeps its plan as it is.
 */
function homeAreas(counts: Map<number, number>[]): Map<number, number> {
  let best = new Map<number, number>();
  let bestScore = -1;
  const walk = (city: number, picked: Map<number, number>, score: number) => {
    if (city === counts.length) {
      if (score > bestScore) [best, bestScore] = [new Map(picked), score];
      return;
    }
    walk(city + 1, picked, score);
    for (const [at, n] of counts[city]) {
      if ([...picked.values()].includes(at)) continue;
      picked.set(city, at);
      walk(city + 1, picked, score + n);
      picked.delete(city);
    }
  };
  walk(0, new Map(), 0);
  return best;
}

/**
 * Each city's plan without the places it holds in another city's area: every
 * city is asked with the whole trip's must-dos, and Seoul's days once held
 * Busan's sights. Each city's area is its own (homeAreas), so a plan that is
 * mostly another city's still finds its own. Cities close enough to share an
 * area, a day trip out to somewhere no city is, and the travel between cities
 * stay. Pure; unit-tested.
 */
export function withoutOtherCitiesPlaces(results: GeneratedItinerary[]): { results: GeneratedItinerary[]; dropped: string[]; strayed: number[] } {
  const places = results.flatMap((r, city) =>
    (r.days ?? []).flatMap((d) =>
      (d.activities ?? []).filter((a) => a.type !== "transport" && isRealPoint(a.coordinates)).map((a) => ({ city, a })),
    ),
  );
  const area = areasOf(places.map((p) => p.a.coordinates as Point));
  const counts = results.map(() => new Map<number, number>());
  places.forEach((p, k) => counts[p.city].set(area[k], (counts[p.city].get(area[k]) ?? 0) + 1));
  const home = homeAreas(counts);
  const homes = [...home.values()];
  const away = new Set(
    places.filter((p, k) => home.has(p.city) && home.get(p.city) !== area[k] && homes.includes(area[k])).map((p) => p.a),
  );
  const dropped = places.filter((p) => away.has(p.a)).map((p) => p.a.name);
  const strayed = [...new Set(places.filter((p) => away.has(p.a)).map((p) => p.city))];
  const kept = results.map((r) => ({
    ...r,
    days: (r.days ?? []).map((d) => ({ ...d, activities: (d.activities ?? []).filter((a) => !away.has(a)) })),
  }));
  return { results: kept, dropped, strayed };
}

const NOT_DISTINCT = new Set(
  "the of de la le el los las del di da do dos das and at in a al to on for".split(" ").concat(
    "temple palace park market museum tower bridge beach castle church cathedral garden gardens village street square".split(" "),
  ),
);
/** The words that tell a place apart: "haedong yonggungsa temple" is "haedong yonggungsa". */
function distinctWords(name: string): string[] {
  const words = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  const own = words.filter((w) => !NOT_DISTINCT.has(w));
  return own.length ? own : words;
}

/**
 * The must-dos another city's plan holds: a city asked again is asked without
 * them, since their city has them. A must-do is held when every word that tells
 * it apart is in a place's name.
 */
export function mustDosOfOtherCities(mustDos: string[], results: GeneratedItinerary[], city: number): string[] {
  const names = results
    .flatMap((r, i) => (i === city ? [] : (r.days ?? []).flatMap((d) => (d.activities ?? []).map((a) => a.name))))
    .map((n) => new Set(distinctWords(n)));
  return mustDos.filter((m) => {
    const words = distinctWords(m);
    return words.length > 0 && names.some((n) => words.every((w) => n.has(w)));
  });
}

/**
 * Stitch independently-generated single-city itineraries into ONE multi-city
 * itinerary:
 *   - concatenate days in city order
 *   - renumber day_number 1..N globally
 *   - re-assign contiguous dates from the trip start (each city was generated
 *     against its own sub-range; we normalise so the merged trip is gap-free)
 *   - tag every day with its `city`
 *   - synthesise the trip-level destination label + merge the summary
 *
 * Pure. The reliability-critical heart of multi-city generation.
 */
export function mergeCityItineraries(
  legs: CityLeg[],
  results: GeneratedItinerary[],
  tripStartDate: string,
  opts?: {
    /** Trip language for the transfer-leg labels ("Treno per Roma"). */
    language?: string;
    /** P4 escape hatch — defaults to inserting transfer legs. */
    insertTransfers?: boolean;
  }
): GeneratedItinerary {
  if (legs.length !== results.length) {
    throw new MultiCityError(
      `mergeCityItineraries: ${legs.length} legs but ${results.length} results`
    );
  }
  if (legs.length === 0) {
    throw new MultiCityError("mergeCityItineraries: nothing to merge");
  }

  const insertTransfers = opts?.insertTransfers !== false;
  const currency = results[0].trip_summary?.currency ?? "USD";

  const mergedDays: ItineraryDay[] = [];
  // Each city's first and last date, for its stay's search.
  const stays: { city: string; first: string; last: string }[] = [];
  // The transfers are priced cards of the plan, so part of its total.
  let transfersCost = 0;
  let globalIndex = 0;
  for (let i = 0; i < results.length; i++) {
    const city = legs[i].city.trim();
    const cityDays = results[i].days ?? [];
    for (let d = 0; d < cityDays.length; d++) {
      const day = cityDays[d];
      const date = addDaysISO(tripStartDate, globalIndex);
      if (d === 0) stays.push({ city, first: date, last: date });
      else stays[stays.length - 1].last = date;
      // P4 transport spine v1: an estimated inter-city transfer leg on each
      // leg-boundary morning ("otherwise it's just a list of activities").
      // Distance comes from the neighbouring activities' own coordinates —
      // pure heuristic, no API. See lib/ai/transfer-legs.ts. The day's own
      // plan makes room for it (dayWithTransfer).
      let activities = day.activities;
      if (insertTransfers && i > 0 && d === 0) {
        const transfer = buildTransferActivity({
          fromCity: legs[i - 1].city.trim(),
          toCity: city,
          fromDays: results[i - 1].days ?? [],
          toDays: cityDays,
          currency,
          language: opts?.language,
        });
        if (transfer.estimated_cost?.currency === currency) transfersCost += transfer.estimated_cost.amount;
        activities = dayWithTransfer(transfer, day.activities ?? []);
      }
      mergedDays.push({
        ...day,
        activities,
        day_number: globalIndex + 1,
        date,
        city,
      });
      globalIndex++;
    }
  }

  const first = results[0];
  const label = joinCities(legs.map((l) => l.city));

  return {
    destination: {
      // Combined label so the auto-generated title reads "A, B & C Trip".
      name: label,
      country: first.destination?.country ?? "",
      description: first.destination?.description ?? "",
      best_for: dedupeStrings(results.flatMap((r) => r.destination?.best_for ?? [])),
      weather_note: first.destination?.weather_note ?? "",
    },
    days: mergedDays,
    trip_summary: {
      total_estimated_cost: results.reduce(
        (sum, r) => sum + (r.trip_summary?.total_estimated_cost ?? 0),
        transfersCost
      ),
      currency: first.trip_summary?.currency ?? "USD",
      highlights: results.flatMap((r) => r.trip_summary?.highlights ?? []),
      packing_suggestions: dedupeStrings(
        results.flatMap((r) => r.trip_summary?.packing_suggestions ?? [])
      ),
    },
    // One way into the first city; a stay per city, to the morning the next
    // one starts (the last one to the trip's last day).
    booking_links: {
      flights: stays.length ? [flightLink(stays[0].city, stays[0].first)] : [],
      hotels: stays.flatMap((s, k) => hotelLinks(s.city, s.first, stays[k + 1]?.first ?? s.last, s.city)),
    },
  };
}
