import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Engagement counters on trips — likes, saves, forks, template copies — and
 * the trending score they feed. Every call to the counter functions goes
 * through here.
 *
 * WHY THE SERVICE ROLE (2026-09-23)
 * The counter functions are SECURITY DEFINER and check nothing about the
 * caller: give them a trip id and they add one, then recompute the trip's
 * trending score. While `authenticated` could execute them, any signed-in
 * account could call POST /rest/v1/rpc/increment_trip_fork_count in a loop
 * and push any trip up /explore (a fork is worth 10 points of trending
 * score, a like 3). Migration 20260924100000 makes them service-role only,
 * so the API routes are the only way in, and each route has already done its
 * check before it counts: the trip is public and not hidden, the caller owns
 * it, or a deduplicating insert/delete (trip_likes, trip_saves) succeeded.
 *
 * The functions do not read auth.uid(), so running them as the service role
 * changes nothing about what they compute.
 *
 * Never throws. A counter that fails to move is logged as drift and the
 * person's action (the like, the fork) still succeeds, as before.
 */

export type TripCounterFn =
  | "increment_trip_like_count"
  | "decrement_trip_like_count"
  | "increment_trip_save_count"
  | "decrement_trip_save_count"
  | "increment_trip_fork_count"
  | "update_trip_trending_score";

/** Runs one counter function on one trip. Returns the new value, or null if it failed. */
export async function runTripCounter(
  fn: TripCounterFn,
  tripId: string,
  logTag: string
): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().rpc(fn, { p_trip_id: tripId });
    if (error) {
      console.error(`[${logTag}] ${fn} failed, counter drift:`, error.message);
      return null;
    }
    return typeof data === "number" ? data : null;
  } catch (err) {
    console.error(`[${logTag}] ${fn} failed, counter drift:`, err);
    return null;
  }
}

/** Adds one to a template's copy count. Returns the new value, or null if it failed. */
export async function incrementTemplateCopyCount(
  templateId: string,
  logTag: string
): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().rpc("increment_template_copy_count", {
      template_id: templateId,
    });
    if (error) {
      console.error(`[${logTag}] increment_template_copy_count failed:`, error.message);
      return null;
    }
    return typeof data === "number" ? data : null;
  } catch (err) {
    console.error(`[${logTag}] increment_template_copy_count failed:`, err);
    return null;
  }
}
