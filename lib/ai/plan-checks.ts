/**
 * What a plan can say was checked for the trip's own dates before it was shown: the closing days of its sights
 * (lib/ai/closing-days.ts keepOffClosingDays), in the few numbers a traveller can read. Client-safe: the plan
 * carries it, the plan screen says it.
 */
export interface PlanChecks {
  /** Sights whose closing days were looked at for the trip's dates. */
  sights: number;
  /** Of them, on a day they are shut in the plan as first written (by their closing days or for the season). */
  shut: number;
  /** Of those, put on a day they are open, or swapped for a place that is. */
  fixed: number;
  /** Of those, still on a day they are shut: each says so on its own stop. */
  left: number;
}

/** The counts the closing-day check gives back that the summary reads. */
export interface ClosingDaysFound {
  asked: number;
  known: number;
  shutBefore: number;
  seasonal: number;
  shutAfter: number;
}

const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The summary of a closing-day check, or null when no sight was looked at: a plan says nothing it didn't do. */
export function planChecks(found: ClosingDaysFound): PlanChecks | null {
  // The sights asked about include the ones the checked list knows; a plan of listed sights alone still counts them.
  const sights = Math.max(whole(found.asked), whole(found.known));
  if (sights === 0) return null;
  // Never more shut than looked at, never more left than were shut: the line must add up for its reader.
  const shut = Math.min(sights, whole(found.shutBefore) + whole(found.seasonal));
  const left = Math.min(shut, whole(found.shutAfter));
  return { sights, shut, fixed: shut - left, left };
}

/** A summary read back from a stored plan: the same four counts, or null for anything else. */
export function readPlanChecks(value: unknown): PlanChecks | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const sights = whole(v.sights);
  if (sights === 0) return null;
  const shut = Math.min(sights, whole(v.shut));
  const left = Math.min(shut, whole(v.left));
  return { sights, shut, fixed: shut - left, left };
}
