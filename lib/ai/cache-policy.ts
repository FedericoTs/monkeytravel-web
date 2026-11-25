import type { GeneratedItinerary, TripCreationParams } from "@/types";
import { altitudeLine } from "@/lib/ai/altitude";

/**
 * When a generation may use the cross-user plan cache. One set of rules for
 * the JSON and the streaming generation routes.
 */
export interface CachePolicy {
  /**
   * Must-dos, a diet, who's coming, where they're staying, a special trip, what's on at their dates, or a first day
   * high up (lib/ai/altitude.ts): a tailored plan is neither answered from the shared pool nor added to it. The pool
   * is keyed without dates, so a plan told the Christmas markets are open would otherwise answer a July trip, and one
   * written before a place's altitude was known would keep answering its trips.
   */
  tailored: boolean;
  /** "Try Different Version": the plan on screen must not come back. */
  fresh: boolean;
  /** The trip's length in days, which the cache key leaves out. */
  totalDays: number;
}

export function cachePolicy(params: TripCreationParams, fresh: boolean, totalDays: number): CachePolicy {
  return {
    tailored: Boolean(
      params.mustDos?.length ||
        params.profilePreferences?.dietaryPreferences?.length ||
        params.tripIntent ||
        params.stay ||
        params.whatsOn?.length ||
        params.occasion ||
        params.arrival ||
        params.departure ||
        altitudeLine(params)
    ),
    fresh,
    totalDays,
  };
}

/**
 * The cached plan this request may be answered with, or null. A longer plan
 * is cut to the trip by adjustItineraryDates; a shorter one never answers.
 */
export function servableCachedPlan(
  cached: GeneratedItinerary | null,
  policy: CachePolicy
): GeneratedItinerary | null {
  if (!cached || policy.tailored || policy.fresh) return null;
  return cached.days.length >= policy.totalDays ? cached : null;
}

/**
 * Whether a newly written plan may go into the shared pool. A fresh redo never
 * replaces a longer entry, which still answers trips up to its length.
 */
export function mayCachePlan(
  plan: GeneratedItinerary,
  cached: GeneratedItinerary | null,
  policy: CachePolicy
): boolean {
  if (policy.tailored) return false;
  return !(policy.fresh && (cached?.days.length ?? 0) > plan.days.length);
}
