import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * GET /api/affiliates/hostelworld/stats
 *
 * Returns 30-day aggregates over public.hostelworld_clicks for the
 * social-proof counter on /backpacker. Public endpoint — no auth needed,
 * because the numbers it returns are the same numbers we'd brag about on
 * the page itself.
 *
 * Service-role client because the clicks table is RLS-closed (writes
 * happen via /api/affiliates/hostelworld/click and reads aren't allowed
 * via PostgREST anon). We do a single COUNT query so the role is fine.
 *
 * Caching: edge-cached for 1 hour (s-maxage=3600). The counter is
 * social proof, not real-time analytics — a slightly stale number is
 * fine and we don't want every /backpacker pageload hammering Supabase.
 *
 * Shipped 2026-05-28 alongside the Hostelworld Phase A push (live
 * stats counter for the partner pitch).
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Graceful empty response so the /backpacker page can degrade
    // to "join the community" copy rather than throw.
    return NextResponse.json(
      { clicks30d: 0, uniqueTrips30d: 0, uniqueVisitors30d: 0, error: "env" },
      { status: 200 },
    );
  }

  const supabase = createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // One query, three aggregates. COUNT(DISTINCT) on trip_id + on the
  // COALESCE(user_id, visitor_cookie) so anon visitors are deduped by
  // their saver cookie — gives a more honest "unique people" number.
  const { data, error } = await supabase
    .rpc("hostelworld_stats_30d", { since: thirtyDaysAgo })
    .single();

  if (error) {
    // RPC may not exist on first deploy — fall back to plain count.
    const { count } = await supabase
      .from("hostelworld_clicks")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo);
    return NextResponse.json(
      {
        clicks30d: count ?? 0,
        uniqueTrips30d: 0,
        uniqueVisitors30d: 0,
      },
      {
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
      },
    );
  }

  type StatsRow = {
    clicks_30d: number;
    unique_trips_30d: number;
    unique_visitors_30d: number;
  };
  const stats = data as StatsRow;

  return NextResponse.json(
    {
      clicks30d: stats.clicks_30d ?? 0,
      uniqueTrips30d: stats.unique_trips_30d ?? 0,
      uniqueVisitors30d: stats.unique_visitors_30d ?? 0,
    },
    {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
    },
  );
}
