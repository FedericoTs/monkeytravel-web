import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedItinerary } from "@/types";

/** Longest the restore waits on this check before restoring as before. */
export const DRAFT_SAVED_CHECK_TIMEOUT_MS = 3000;

/**
 * Is the itinerary in a wizard draft already one of the user's trips?
 *
 * Activity ids are minted when the itinerary is generated and kept by the
 * saved row (#181), and the draft and the trip were written in step, so a trip
 * of this user holding the draft's first activity id is that draft, saved.
 * decideDraftRestore then discards the draft instead of restoring it into a
 * second insert. (Measured 2026-09-26: of 543 trips, no first activity id is
 * shared between two users, so a match is never someone else's trip.)
 *
 * Soft-deleted trips are invisible here (trips RLS reads deleted_at IS NULL
 * only), so a draft of a trip the user has since deleted still restores, as
 * it did before.
 *
 * Fails open: an error, a timeout or an itinerary without ids answers false,
 * which restores the draft exactly as before this check existed.
 */
export async function isItinerarySaved(
  supabase: SupabaseClient,
  userId: string,
  itinerary: GeneratedItinerary,
  timeoutMs: number = DRAFT_SAVED_CHECK_TIMEOUT_MS
): Promise<boolean> {
  const id = firstActivityId(itinerary);
  if (!id) return false;
  const lookup = (async () => {
    try {
      const { data, error } = await supabase
        .from("trips")
        .select("id")
        .eq("user_id", userId)
        // A string, not an array: postgrest-js turns a JS array into a
        // Postgres array literal ({...}), which never matches a jsonb column.
        .contains("itinerary", JSON.stringify([{ activities: [{ id }] }]))
        .limit(1);
      if (error) return false;
      return (data?.length ?? 0) > 0;
    } catch {
      return false;
    }
  })();
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([lookup, timeout]);
}

/** The id of the first activity in the itinerary, or null when there is none. */
export function firstActivityId(itinerary: GeneratedItinerary | null | undefined): string | null {
  for (const day of itinerary?.days ?? []) {
    for (const activity of day.activities ?? []) {
      if (typeof activity.id === "string" && activity.id.length > 0) return activity.id;
    }
  }
  return null;
}
