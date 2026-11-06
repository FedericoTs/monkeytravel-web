/**
 * Check my plan: which of a pasted plan's places to eat Google Maps has as
 * closed, and which days are too full. Sights aren't looked up: they rarely
 * close and their names match badly. Nothing Google answers is kept: the report
 * goes back to the page that asked, and only there.
 */
import { isPlaceToEat, lookUpPlaceToEat, type PlaceStatus } from "@/lib/places/places-to-eat";
import { isOverpacked } from "@/lib/trip/pace";
import { MUST_DOS_MAX, MUST_DO_MAX_LENGTH } from "@/lib/trips/request-limits";
import type { Activity } from "@/types";
import type { PastedPlan, PastedStop } from "./plan-check-extract";

// Searches one check may make. Past Google's free tier each one is paid for.
export const MAX_PLACE_LOOKUPS = 10;
const AT_ONCE = 3;

export interface CheckedStop {
  name: string;
  /** What Maps says; null for a stop that wasn't looked up. */
  status: PlaceStatus | null;
}

export interface CheckedDay {
  label: string;
  stops: CheckedStop[];
  packed: boolean;
}

export interface PlanReport {
  destination: string;
  days: CheckedDay[];
  /** Places looked up, which is 0 when none were or the searches failed. */
  looked: number;
  closed: number;
  missing: number;
  packedDays: number;
  /** Places the wizard could keep if the plan is built here: every real stop but the closed ones. */
  keep: string[];
}

/** A hotel or a transfer is how the day works, not what fills it. */
const isVisit = ({ type }: PastedStop) => type !== "transport" && type !== "lodging";

async function inTurns<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < jobs.length; i += AT_ONCE) {
    results.push(...(await Promise.all(jobs.slice(i, i + AT_ONCE).map((job) => job()))));
  }
  return results;
}

/** `lookUp` false reports the days with no search made. */
export async function checkPlan(plan: PastedPlan, { lookUp }: { lookUp: boolean }): Promise<PlanReport> {
  const places = lookUp
    ? plan.days
        .flatMap((day) => day.stops)
        .filter((stop) => isPlaceToEat({ name: stop.name, type: stop.type as Activity["type"] }))
        .slice(0, MAX_PLACE_LOOKUPS)
    : [];
  const statuses = await inTurns(
    places.map((stop) => () => lookUpPlaceToEat(stop.name, stop.where || plan.destination)),
  );
  const found = new Map(places.map((stop, i) => [stop, statuses[i]]));

  const days = plan.days.map((day): CheckedDay => {
    const visits = day.stops.filter(isVisit);
    return {
      label: day.label,
      stops: visits.map((stop) => ({ name: stop.name, status: found.get(stop) ?? null })),
      packed: isOverpacked(
        visits.map((stop) => ({ duration_minutes: stop.minutes })),
        "moderate",
      ),
    };
  });
  const stops = days.flatMap((day) => day.stops);
  return {
    destination: plan.destination,
    days,
    looked: stops.filter((stop) => stop.status).length,
    closed: stops.filter((stop) => stop.status === "closed").length,
    missing: stops.filter((stop) => stop.status === "missing").length,
    packedDays: days.filter((day) => day.packed).length,
    keep: [...new Set(stops.filter((stop) => stop.status !== "closed").map((stop) => stop.name.slice(0, MUST_DO_MAX_LENGTH)))].slice(0, MUST_DOS_MAX),
  };
}
