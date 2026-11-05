import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseUnlessCron } from "@/lib/api/cron-auth";

/**
 * Daily cron — REFRESH MATERIALIZED VIEW CONCURRENTLY public.activity_index.
 *
 * The MV (see supabase/migrations/20260530_activity_index_mview.sql) flattens
 * every public/shared trip's itinerary JSONB into one row per activity, with
 * normalised text + trigram GIN indexes. `/api/activities/search` queries it
 * via the `search_activities()` RPC — orders of magnitude cheaper than the
 * previous "SELECT top 100 trips → loop in Node" path.
 *
 * Schedule: daily via Vercel cron (see vercel.json). Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/refresh-activity-index
 *
 * Concurrency: CONCURRENTLY keeps the MV queryable during refresh — requires
 * the UNIQUE INDEX on row_key, which the migration creates.
 *
 * Risk note: at ~100k+ activities the refresh may approach the 60s function
 * cap (vercel.json sets maxDuration: 60 on app/api/cron/*). When that
 * becomes a problem, swap the MV for a flat table + trigger-based incremental
 * updates on trips.itinerary. At the current row count we're nowhere near it.
 *
 * Auth: CRON_SECRET. Without it, 401. Vercel sends the secret automatically.
 */

export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const svc = createAdminClient();
  const startedAt = Date.now();

  // The SECURITY DEFINER refresh_activity_index() function wraps
  // REFRESH MATERIALIZED VIEW CONCURRENTLY so the service role doesn't need
  // to own the MV. Defined in the migration alongside the MV itself. The
  // places travellers kept (public.known_places) are rebuilt the same way.
  for (const rpc of ["refresh_activity_index", "refresh_known_places"]) {
    const { error } = await svc.rpc(rpc);
    if (error) {
      console.error(`[refresh-activity-index] ${rpc} failed:`, error);
      return NextResponse.json(
        { error: "Refresh failed", detail: error.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
