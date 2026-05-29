import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

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
 * updates on trips.itinerary. For 444 current rows we're nowhere near it.
 *
 * Auth: CRON_SECRET. Without it, 401. Vercel sends the secret automatically.
 */

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for cron");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Don't run unauthenticated, even if CRON_SECRET isn't set.
    return unauthorized();
  }
  if (auth !== `Bearer ${secret}`) return unauthorized();

  const svc = serviceClient();
  const startedAt = Date.now();

  // The SECURITY DEFINER refresh_activity_index() function wraps
  // REFRESH MATERIALIZED VIEW CONCURRENTLY so the service role doesn't need
  // to own the MV. Defined in the migration alongside the MV itself.
  const { error } = await svc.rpc("refresh_activity_index");

  if (error) {
    console.error("[refresh-activity-index] RPC failed:", error);
    return NextResponse.json(
      { error: "Refresh failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
