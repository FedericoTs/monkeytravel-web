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
import { knownPlacesFor } from "./known-places";
import { askForTransfers } from "./transfer-question";
import { answeredTransfer, rideIn } from "./transfer-legs";
import { cityPointsFor } from "./city-points";
import { curatedPointFor } from "./place-point";
import { namesakesElsewhere, unmirroredCities } from "./mirrored-cities";
import { daylightFor } from "./daylight";
import { whatsOn } from "./whats-on";
import {
  type CityLeg,
  addDaysISO,
  mergeCityItineraries,
  mustDosOfOtherCities,
  returnStayRepeats,
  validateLegs,
  withoutOtherCitiesPlaces,
} from "./multi-city-core";

export type { CityLeg } from "./multi-city-core";
export { MAX_CITIES, MultiCityError, validateLegs } from "./multi-city-core";

/** Per-trip params shared across every city leg (no destination/date range). */
export type MultiCityBaseParams = Omit<
  TripCreationParams,
  "destination" | "startDate" | "endDate"
>;

/** The hops between the cities, how many the answer covered, and how many of those the cards took. */
export interface TransfersReport {
  hops: number;
  answered: number;
  used: number;
}

/** A city with its country named: "kochi, India" from the table's code, or the curated destination's country. */
function withCountry(city: string, country: string): string {
  let name = country;
  if (/^[A-Z]{2}$/.test(country)) {
    try {
      name = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
    } catch {
      // The code as it is.
    }
  }
  return `${city.trim()}, ${name}`;
}

/**
 * Generate a multi-city itinerary: one independent single-city generation per
 * leg (parallel), merged into one trip. `tripStartDate` is the trip's first day;
 * each leg's date sub-range is derived from the cumulative nights.
 */
export async function generateMultiCityItinerary(
  base: MultiCityBaseParams,
  legs: CityLeg[],
  tripStartDate: string,
  options?: Parameters<typeof generateItinerary>[1],
  onTransfers?: (report: TransfersReport) => void
): Promise<GeneratedItinerary> {
  validateLegs(legs);

  // How travellers make each hop, asked while the cities are planned: the
  // cards between them take the answer where it can be right. The same
  // question asks the way back to the first city, unless the route ends there.
  const cities = legs.map((leg) => leg.city.trim());
  const endsWhereItBegan = cities[cities.length - 1].toLowerCase() === cities[0].toLowerCase();
  const transfersAsked = askForTransfers(endsWhereItBegan ? cities : [...cities, cities[0]]);
  // Where each city is, for its own sunrise and sunset: a route sends no one
  // place's coordinates. A curated destination of that name first (the table
  // has no "Santorini"; its biggest "Bali" is in India), then the cities
  // table for the rest, which tells namesakes apart by the route.
  const curated = await Promise.all(cities.map((city) => curatedPointFor(city)));
  const tabled = await cityPointsFor(cities.map((city, i) => (curated[i] ? "" : city)));
  const points = cities.map((_, i) => curated[i] ?? tabled[i]);

  // Derive each city's date sub-range from the cumulative nights so the legs
  // tile the trip with no gap or overlap.
  let cursor = 0;
  const perCityParams: TripCreationParams[] = legs.map((leg, i) => {
    const cityStart = addDaysISO(tripStartDate, cursor);
    const cityEnd = addDaysISO(tripStartDate, cursor + leg.nights - 1);
    cursor += leg.nights;
    const daylight = daylightFor(points[i], cityStart, cityEnd);
    // A later city's first day begins with the ride from the city before: its plan starts when the ride gets in,
    // instead of planning a whole day whose morning the ride then takes (lib/ai/transfer-legs.ts arrivalDay).
    const ride = i > 0 ? rideIn(points[i - 1] ?? null, points[i] ?? null) : null;
    // Each city's plan knows the whole route: a name that fits several places
    // (Córdoba, Mérida) or a misspelled one means the one on it. And what is on
    // there on its own dates (lib/ai/whats-on.ts).
    return {
      ...base,
      destinations: legs,
      destination: leg.city,
      startDate: cityStart,
      endDate: cityEnd,
      ...(daylight ? { daylight } : {}),
      whatsOn: whatsOn(points[i], cityStart, cityEnd),
      ...(ride ? { arrivesBy: { from: legs[i - 1].city.trim(), ...ride } } : {}),
    };
  });

  // Parallel: wall-clock = slowest single city, not the sum. Each city starts
  // from the places travellers kept there.
  const generate = async (p: TripCreationParams, i: number) =>
    generateItinerary(p, {
      ...options,
      knownPlaces: await knownPlacesFor(p, legs[i].nights, options?.language ?? "en"),
    });
  const results = await Promise.all(perCityParams.map(generate));

  // A city the route comes back to is planned twice at the same time, and its later stay repeated the earlier one's
  // sights. Such a stay is asked once more, told what the earlier stay holds; an ask after this one keeps that.
  const returns = returnStayRepeats(legs, results);
  if (returns.length > 0) {
    console.warn(`[multi-city] a later stay repeated an earlier one, asked again: ${returns.map((r) => cities[r.index]).join(", ")}`);
    await Promise.all(
      returns.map(async ({ index, earlier }) => {
        perCityParams[index] = { ...perCityParams[index], alreadyPlanned: earlier };
        results[index] = await generate(perCityParams[index], index);
      }),
    );
  }

  // A city planned at a namesake on another continent ("kochi" in Japan on a trip through Kerala, though each city's
  // plan knows the whole route) is asked once more with its country named: the route's points know which it is.
  const elsewhere = namesakesElsewhere(results, points);
  if (elsewhere.length > 0) {
    console.warn(`[multi-city] planned at a namesake elsewhere, asked again: ${elsewhere.map((i) => cities[i]).join(", ")}`);
    await Promise.all(
      elsewhere.map(async (i) => {
        perCityParams[i] = { ...perCityParams[i], destination: withCountry(legs[i].city, points[i]!.country!) };
        results[i] = await generate(perCityParams[i], i);
      }),
    );
  }

  // Each city keeps only its own places: a must-do of another city stays off its
  // days. A city that planned some anyway is asked once more, without the
  // must-dos the other cities hold, so its days aren't left short.
  let inTheirCities = withoutOtherCitiesPlaces(results);
  if (inTheirCities.dropped.length > 0) {
    console.warn(`[multi-city] left out places in another city: ${inTheirCities.dropped.join(", ")}`);
    const mustDos = base.mustDos ?? [];
    if (mustDos.length > 0) {
      await Promise.all(
        inTheirCities.strayed.map(async (i) => {
          const elsewhere = mustDosOfOtherCities(mustDos, inTheirCities.results, i);
          results[i] = await generate({ ...perCityParams[i], mustDos: mustDos.filter((m) => !elsewhere.includes(m)) }, i);
        }),
      );
      inTheirCities = withoutOtherCitiesPlaces(results);
      if (inTheirCities.dropped.length > 0) {
        console.warn(`[multi-city] asked again, still left out: ${inTheirCities.dropped.join(", ")}`);
      }
    }
  }
  // A city that came back at the mirror image of where it is goes back on the route before the cards between the
  // cities are measured from its stops (lib/ai/mirrored-cities.ts).
  const placed = unmirroredCities(inTheirCities.results, points);
  if (placed.turned.length > 0) {
    console.warn(`[multi-city] stops turned back from the far side of the world: ${placed.turned.map((i) => cities[i]).join(", ")}`);
  }
  // Transfer-leg labels follow the same language the per-city generations
  // used — it rides on the generation options, not the base params.
  const { hops } = await transfersAsked;
  const merged = mergeCityItineraries(legs, placed.results, tripStartDate, {
    language: options?.language,
    hops,
  });
  const cityDays = placed.results.map((r) => r.days ?? []);
  onTransfers?.({
    hops: legs.length - 1,
    answered: hops.slice(0, legs.length - 1).filter(Boolean).length,
    used: cityDays.slice(1).filter((days, i) => answeredTransfer(hops[i], cityDays[i], days)).length,
  });

  // Post-merge validation — warn, don't throw: a usable trip beats a hard fail.
  const expectedDays = legs.reduce((s, l) => s + l.nights, 0);
  if (merged.days.length !== expectedDays) {
    console.warn(
      `[multi-city] day-count mismatch: expected ${expectedDays}, got ${merged.days.length}`
    );
  }
  // A city the route comes back to is one city.
  const routeCities = new Set(cities);
  const taggedCities = new Set(merged.days.map((d) => d.city).filter(Boolean));
  if (taggedCities.size !== routeCities.size) {
    console.warn(
      `[multi-city] city-count mismatch: expected ${routeCities.size} cities, ${taggedCities.size} tagged`
    );
  }

  return merged;
}
