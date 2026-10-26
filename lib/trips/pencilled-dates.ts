/**
 * Dates the planner pencilled in for a trip (flexible dates, a plan typed as
 * one sentence), as trip_meta.dates_pencilled records them.
 *
 * They are a placeholder, not a departure, so the trip's emails wait while the
 * trip still has exactly these dates. Choosing dates, on any path, ends that
 * by itself: the trip's dates stop matching.
 */
export type PencilledDates = { start: string; end: string };

/** True while the trip's dates are still the ones pencilled in for it. */
export function stillPencilled(pencilled: unknown, startDate: string, endDate: string): boolean {
  if (!pencilled || typeof pencilled !== "object") return false;
  const { start, end } = pencilled as Record<string, unknown>;
  return start === startDate && end === endDate;
}
