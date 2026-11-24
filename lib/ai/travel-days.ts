/**
 * How a plan fits when they arrive and leave (TripCreationParams.arrival and departure): the stops on the first day
 * before they can be there, and on the last day after they must be gone. The journey itself (the arrival, a transfer,
 * the check-in, the way to the airport or station) never counts. Read for the plan's log and for the evals.
 */

import { JOURNEY, minutesOf } from "@/lib/ai/assistant/travel-times";
import type { Arrival, Departure } from "@/lib/wizard/answers";
import type { Activity, ItineraryDay, TripCreationParams } from "@/types";

/** From when the first day can hold a stop, by when they arrive: the times the prompt's words give. */
export const ARRIVAL_FROM: Record<Arrival, number> = {
  morning: 11 * 60,
  afternoon: 15 * 60 + 30,
  evening: 19 * 60 + 30,
  night: 24 * 60,
};

/** By when the last day's stops are over, by when they leave. */
export const DEPARTURE_BY: Record<Departure, number> = {
  morning: 9 * 60 + 30,
  afternoon: 12 * 60 + 30,
  evening: 16 * 60,
};

/** A quarter of an hour either side is still the time asked. */
const SLACK = 15;

const isJourney = (a: Activity) => a.type === "transport" || a.type === "accommodation" || JOURNEY.test(a.name ?? "");

export interface TravelDaysFit {
  arrival?: Arrival;
  departure?: Departure;
  /** Stops on the arrival day that start before they can be there. */
  early: number;
  /** Stops on the leaving day still going after they must be gone. */
  late: number;
}

/** The fit, or null when the plan was asked for neither. A day the plan doesn't hold counts nothing. */
export function travelDaysFit(
  days: ItineraryDay[],
  { arrival, departure }: Pick<TripCreationParams, "arrival" | "departure">
): TravelDaysFit | null {
  if (!arrival && !departure) return null;
  const first = arrival ? days.find((d) => d.date === arrival.date) : undefined;
  const last = departure ? days.find((d) => d.date === departure.date) : undefined;
  const early = first && arrival
    ? (first.activities ?? []).filter((a) => !isJourney(a) && minutesOf(a.start_time) < ARRIVAL_FROM[arrival.when] - SLACK).length
    : 0;
  const late = last && departure
    ? (last.activities ?? []).filter(
        (a) => !isJourney(a) && minutesOf(a.start_time) + (a.duration_minutes ?? 0) > DEPARTURE_BY[departure.when] + SLACK
      ).length
    : 0;
  return { ...(arrival ? { arrival: arrival.when } : {}), ...(departure ? { departure: departure.when } : {}), early, late };
}
