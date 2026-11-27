"use client";

import { useCallback, useState, type SetStateAction } from "react";
import type { GeneratedItinerary } from "@/types";
import { ensureActivityIds } from "@/lib/utils/activity-id";

/** What a plan's closing-day check was made of: each day's date and its stops by name, in order. */
function checkedShape(plan: GeneratedItinerary): string {
  return plan.days
    .map((day) => `${day?.date ?? ""}:${Array.isArray(day?.activities) ? day.activities.map((a) => a?.name ?? "").join("|") : ""}`)
    .join("\n");
}

/**
 * A plan's note of what was checked (lib/ai/plan-checks.ts) holds for the days it was checked on. Once the browser
 * changes a date or a stop (the assistant's edit, new dates), the note no longer describes the plan, so it goes;
 * an undo that puts the checked days back brings it back with them. A photo arriving on a stop changes neither.
 */
function withHonestChecks(prev: GeneratedItinerary | null, value: GeneratedItinerary): GeneratedItinerary {
  if (!value.checked || !prev || prev.checked !== value.checked) return value;
  if (checkedShape(prev) === checkedShape(value)) return value;
  const rest = { ...value };
  delete rest.checked;
  return rest;
}

/**
 * The wizard's plan. Activity ids are given here, once, so the auto-save insert,
 * every later update and the share link carry the SAME ids; fresh random ids on
 * each update would move itinerary_version and cut off anything keyed by id. The
 * object is only rebuilt when an id is actually missing, so a no-op set does not
 * look like a new itinerary to the auto-save.
 */
export function useGeneratedPlan() {
  const [plan, setPlanRaw] = useState<GeneratedItinerary | null>(null);
  const setPlan = useCallback((next: SetStateAction<GeneratedItinerary | null>) => {
    setPlanRaw((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (!value || !Array.isArray(value.days)) return value;
      const honest = withHonestChecks(prev, value);
      const missing = honest.days.some(
        (d) => Array.isArray(d?.activities) && d.activities.some((a) => a && typeof a === "object" && !a.id)
      );
      return missing ? { ...honest, days: ensureActivityIds(honest.days) } : honest;
    });
  }, []);
  return [plan, setPlan] as const;
}
