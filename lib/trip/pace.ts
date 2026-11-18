/**
 * Quantified pace budgets — the single definition of what "relaxed",
 * "moderate" and "active" actually mean in activities and hours.
 *
 * WHY: as a bare word passed through the whole system (the wizard collects
 * it, the prompt echoes it), pace measures nothing, and a day can LOOK fine
 * as a list while holding 11 hours of scheduled activity on a "moderate" trip.
 * Feasibility has to be a number before the UI or the model can be held to it.
 *
 * Calibration: the generator averages about three sights and activities a
 * day of a couple of hours each, besides lunch and dinner. Budgets bracket
 * that reality rather than aspiring to a different one, so the overpacked
 * flag stays a signal, not wallpaper. Meals don't count toward the target:
 * counted, they were what a plan dropped to fit another sight.
 *
 * Pure and dependency-free — imported by client components (DaySummary),
 * server prompts (lib/ai/trip-prompt.ts, lib/gemini.ts) and unit tests alike.
 */

import type { TripPace } from "@/types";

export interface PaceBudget {
  /** Target number of sights and activities per day, lunch and dinner not counted. */
  targetActivities: number;
  /** Soft ceiling on the sum of activity duration_minutes per day, meals included. */
  maxActivityMinutes: number;
}

export const PACE_BUDGETS: Record<TripPace, PaceBudget> = {
  relaxed: { targetActivities: 2, maxActivityMinutes: 360 },
  moderate: { targetActivities: 3, maxActivityMinutes: 480 },
  active: { targetActivities: 4, maxActivityMinutes: 600 },
};

/**
 * Coerce anything the DB or an older interface hands us into a TripPace.
 * Legacy "packed" (an old pace value) reads as
 * "active"; everything unknown — including trips saved before trip_meta.pace
 * existed — defaults to "moderate".
 */
export function normalizePace(value: unknown): TripPace {
  if (value === "relaxed" || value === "active") return value;
  if (value === "packed") return "active";
  return "moderate";
}

/**
 * Sum of duration_minutes across a day's activities. Tolerates malformed
 * itineraries (missing/negative/non-numeric durations count as 0) because
 * assistant edits and older trips don't guarantee the field.
 */
export function sumPlannedMinutes(
  activities: ReadonlyArray<{ duration_minutes?: number | null }> | null | undefined
): number {
  if (!activities) return 0;
  return activities.reduce((total, a) => {
    const d = typeof a.duration_minutes === "number" && a.duration_minutes > 0 ? a.duration_minutes : 0;
    return total + d;
  }, 0);
}

// A meal's type, read for what it says: plans type meals loosely ("foodie", "restaurante", "meal").
const MEAL_TYPE = /food|restaur|ristorant|caf[eé]|meal|bakery|brunch|bistro|tapas|\bbar\b|\bpub\b/i;

/** Whether a stop is a meal: it doesn't count toward a day's pace target. */
export function isMealStop(activity: { type?: string | null }): boolean {
  return MEAL_TYPE.test(activity.type ?? "");
}

/**
 * Soft overpacked test: 25% over the time budget OR two sights and activities
 * past the target count, meals not counted. The time arm catches the sneakier
 * case of four 3-hour activities.
 */
export function isOverpacked(
  activities: ReadonlyArray<{ duration_minutes?: number | null; type?: string | null }> | null | undefined,
  pace: TripPace
): boolean {
  const budget = PACE_BUDGETS[pace];
  const planned = sumPlannedMinutes(activities);
  const count = (activities ?? []).filter((a) => !isMealStop(a)).length;
  return planned > budget.maxActivityMinutes * 1.25 || count >= budget.targetActivities + 2;
}

/** What the assistant is asked when someone presses to lighten a packed day. */
export function lightenDayRequest(
  dayNumber: number,
  activities: ReadonlyArray<{ duration_minutes?: number | null }> | null | undefined
): string {
  const hours = Math.round(sumPlannedMinutes(activities) / 60);
  return `Day ${dayNumber} has ${activities?.length ?? 0} stops and about ${hours} hours planned, which feels packed. Make it more relaxed.`;
}

/**
 * Human sentence quantifying a pace for generation prompts, e.g. "aim for ~3
 * sights and activities a day besides lunch and dinner, and keep each day's
 * total time under 8 hours".
 * Accepts the raw (possibly legacy) pace string so prompt call sites don't
 * each re-normalize.
 */
export function paceBudgetPromptClause(pace: string): string {
  const budget = PACE_BUDGETS[normalizePace(pace)];
  const hours = Math.round(budget.maxActivityMinutes / 60);
  return `aim for ~${budget.targetActivities} sights and activities a day besides lunch and dinner, and keep each day's total time (sum of duration_minutes, meals included) under ${hours} hours`;
}
