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

/** Max cities per trip in v1 (caps complexity + generation quality). */
export const MAX_CITIES = 3;

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

/** Add `days` to a YYYY-MM-DD date (UTC), returning YYYY-MM-DD. */
export function addDaysISO(startISO: string, days: number): string {
  const d = new Date(`${startISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new MultiCityError(`addDaysISO: invalid date "${startISO}"`);
  }
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  tripStartDate: string
): GeneratedItinerary {
  if (legs.length !== results.length) {
    throw new MultiCityError(
      `mergeCityItineraries: ${legs.length} legs but ${results.length} results`
    );
  }
  if (legs.length === 0) {
    throw new MultiCityError("mergeCityItineraries: nothing to merge");
  }

  const mergedDays: ItineraryDay[] = [];
  let globalIndex = 0;
  for (let i = 0; i < results.length; i++) {
    const city = legs[i].city.trim();
    for (const day of results[i].days ?? []) {
      mergedDays.push({
        ...day,
        day_number: globalIndex + 1,
        date: addDaysISO(tripStartDate, globalIndex),
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
        0
      ),
      currency: first.trip_summary?.currency ?? "USD",
      highlights: results.flatMap((r) => r.trip_summary?.highlights ?? []),
      packing_suggestions: dedupeStrings(
        results.flatMap((r) => r.trip_summary?.packing_suggestions ?? [])
      ),
    },
    // Flights to the trip come from the first city; hotels are merged across all.
    booking_links: first.booking_links
      ? {
          flights: first.booking_links.flights ?? [],
          hotels: results.flatMap((r) => r.booking_links?.hotels ?? []),
        }
      : undefined,
  };
}
