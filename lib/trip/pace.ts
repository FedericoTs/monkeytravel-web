/**
 * Quantified pace budgets — the single definition of what "relaxed",
 * "moderate" and "active" actually mean in activities and hours.
 *
 * WHY (P3b, Ivan feedback 2026-08): pace was a bare word passed through the
 * whole system — the wizard collected it, the prompt echoed it, and nothing
 * ever measured a generated day against it. The result: days that LOOK fine
 * as a list but are 11 hours of scheduled activity on a "moderate" trip.
 * Feasibility has to be a number before the UI or the model can be held to it.
 *
 * Calibration: measured across saved trips 2026-08 the generator averages
 * 3.99 activities/day at ~127 min each (~8.4h). Budgets bracket that reality
 * rather than aspiring to a different one, so the overpacked flag stays a
 * signal, not wallpaper.
 *
 * Pure and dependency-free — imported by client components (DaySummary),
 * server prompts (lib/gemini.ts) and unit tests alike.
 */

export type TripPace = "relaxed" | "moderate" | "active";

export interface PaceBudget {
  /** Target number of scheduled activities per day. */
  targetActivities: number;
  /** Soft ceiling on the sum of activity duration_minutes per day. */
  maxActivityMinutes: number;
}

export const PACE_BUDGETS: Record<TripPace, PaceBudget> = {
  relaxed: { targetActivities: 3, maxActivityMinutes: 360 },
  moderate: { targetActivities: 4, maxActivityMinutes: 480 },
  active: { targetActivities: 5, maxActivityMinutes: 600 },
};

/**
 * Coerce anything the DB or an older interface hands us into a TripPace.
 * Legacy "packed" (GenerateMoreDaysParams still declares it) reads as
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

/**
 * Soft overpacked test: 25% over the time budget OR two activities past the
 * target count. The count arm keeps parity with the assistant's busy-day
 * heuristic (BUSY_THRESHOLD = 6 ≙ moderate target 4 + 2); the time arm
 * catches the sneakier case of four 3-hour activities.
 */
export function isOverpacked(
  activities: ReadonlyArray<{ duration_minutes?: number | null }> | null | undefined,
  pace: TripPace
): boolean {
  const budget = PACE_BUDGETS[pace];
  const planned = sumPlannedMinutes(activities);
  const count = activities?.length ?? 0;
  return planned > budget.maxActivityMinutes * 1.25 || count >= budget.targetActivities + 2;
}

/**
 * Human sentence quantifying a pace for generation prompts, e.g.
 * "aim for ~4 activities/day and keep each day's total activity time under 8h".
 * Accepts the raw (possibly legacy) pace string so prompt call sites don't
 * each re-normalize.
 */
export function paceBudgetPromptClause(pace: string): string {
  const budget = PACE_BUDGETS[normalizePace(pace)];
  const hours = Math.round(budget.maxActivityMinutes / 60);
  return `aim for ~${budget.targetActivities} activities/day and keep each day's total activity time (sum of duration_minutes) under ${hours} hours`;
}
