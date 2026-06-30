/**
 * Multi-city generation orchestrator (Phase 1 of the multi-city wedge).
 *
 * Reliability-first architecture (per docs/MULTI_CITY_PLAN.md §9): rather than
 * one giant multi-city prompt (truncation + latency risk on long trips), each
 * city is generated INDEPENDENTLY and in PARALLEL over its own date sub-range,
 * then stitched together by the pure core (lib/ai/multi-city-core.ts).
 *
 * Why per-city beats one-prompt: smaller prompts ⇒ far less JSON truncation;
 * parallel ⇒ wall-clock is the slowest single city, not the sum; and each city
 * keeps its OWN coordinates (no per-city coordinate-fallback needed).
 */
import type { GeneratedItinerary, TripCreationParams } from "@/types";
import { generateItinerary } from "@/lib/gemini";
import {
  type CityLeg,
  addDaysISO,
  mergeCityItineraries,
  validateLegs,
} from "./multi-city-core";

export type { CityLeg } from "./multi-city-core";
export { MAX_CITIES, MultiCityError } from "./multi-city-core";

/** Per-trip params shared across every city leg (no destination/date range). */
export type MultiCityBaseParams = Omit<
  TripCreationParams,
  "destination" | "startDate" | "endDate"
>;

/**
 * Generate a multi-city itinerary: one independent single-city generation per
 * leg (parallel), merged into one trip. `tripStartDate` is the trip's first day;
 * each leg's date sub-range is derived from the cumulative nights.
 */
export async function generateMultiCityItinerary(
  base: MultiCityBaseParams,
  legs: CityLeg[],
  tripStartDate: string,
  options?: Parameters<typeof generateItinerary>[1]
): Promise<GeneratedItinerary> {
  validateLegs(legs);

  // Derive each city's date sub-range from the cumulative nights so the legs
  // tile the trip with no gap or overlap.
  let cursor = 0;
  const perCityParams: TripCreationParams[] = legs.map((leg) => {
    const cityStart = addDaysISO(tripStartDate, cursor);
    const cityEnd = addDaysISO(tripStartDate, cursor + leg.nights - 1);
    cursor += leg.nights;
    return { ...base, destination: leg.city, startDate: cityStart, endDate: cityEnd };
  });

  // Parallel: wall-clock = slowest single city, not the sum.
  const results = await Promise.all(
    perCityParams.map((p) => generateItinerary(p, options))
  );

  const merged = mergeCityItineraries(legs, results, tripStartDate);

  // Post-merge validation — warn, don't throw: a usable trip beats a hard fail.
  const expectedDays = legs.reduce((s, l) => s + l.nights, 0);
  if (merged.days.length !== expectedDays) {
    console.warn(
      `[multi-city] day-count mismatch: expected ${expectedDays}, got ${merged.days.length}`
    );
  }
  const taggedCities = new Set(merged.days.map((d) => d.city).filter(Boolean));
  if (taggedCities.size !== legs.length) {
    console.warn(
      `[multi-city] city-count mismatch: expected ${legs.length} cities, ${taggedCities.size} tagged`
    );
  }

  return merged;
}
