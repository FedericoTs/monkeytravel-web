"use client";

import { useCallback, useState, type SetStateAction } from "react";
import type { GeneratedItinerary } from "@/types";
import { ensureActivityIds } from "@/lib/utils/activity-id";

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
      const missing = value.days.some(
        (d) => Array.isArray(d?.activities) && d.activities.some((a) => a && typeof a === "object" && !a.id)
      );
      return missing ? { ...value, days: ensureActivityIds(value.days) } : value;
    });
  }, []);
  return [plan, setPlan] as const;
}
