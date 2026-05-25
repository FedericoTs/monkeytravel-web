import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const SAVER_COOKIE = "mt_saver_cookie";

/**
 * Tells the EngagementBar whether the current viewer has already
 * liked + saved this trip. Resilient to:
 *   - Missing migration (returns false for everything if the table
 *     doesn't exist)
 *   - Anon viewer (uses cookie for save, returns false for like)
 *   - Service-role unavailable for anon save check (returns false)
 *
 * Called from server components that render EngagementBar so we can
 * hydrate the initial state without a client-side fetch round-trip.
 */
export async function getTripViewerState(tripId: string): Promise<{
  hasLiked: boolean;
  hasSaved: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let hasLiked = false;
  let hasSaved = false;

  if (user) {
    // Two parallel lookups for auth viewers.
    const [likeR, saveR] = await Promise.all([
      supabase
        .from("trip_likes")
        .select("trip_id", { head: true, count: "exact" })
        .eq("trip_id", tripId)
        .eq("user_id", user.id),
      supabase
        .from("trip_saves")
        .select("id", { head: true, count: "exact" })
        .eq("trip_id", tripId)
        .eq("user_id", user.id),
    ]);
    hasLiked = (likeR.count ?? 0) > 0;
    hasSaved = (saveR.count ?? 0) > 0;
  } else {
    // Anon: cookie save lookup only (no anon likes).
    const cookieStore = await cookies();
    const cookieId = cookieStore.get(SAVER_COOKIE)?.value;
    if (cookieId) {
      // Anon reads of trip_saves require service-role (RLS rejects
      // anon JWT for non-self rows). Best-effort: if service-role
      // env is missing, default to false rather than throw.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        const svc = createServiceClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { count } = await svc
          .from("trip_saves")
          .select("id", { head: true, count: "exact" })
          .eq("trip_id", tripId)
          .eq("saver_cookie_id", cookieId);
        hasSaved = (count ?? 0) > 0;
      }
    }
  }

  return { hasLiked, hasSaved };
}
