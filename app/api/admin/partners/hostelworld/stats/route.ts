import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/admin";

/**
 * GET /api/admin/partners/hostelworld/stats
 *
 * Powers /admin/partners/hostelworld/dashboard.
 *
 * Returns the four numbers + three breakdowns the partner-sync
 * conversation needs:
 *   - headline: 30-day clicks / unique trips / unique visitors / signups
 *     attributed to acquisition_source='hostelworld'
 *   - daily: per-day clicks + unique_visitors + device split (for the chart)
 *   - topDestinations: top 10 cities clicked
 *   - signupTrend: per-day Hostelworld-attributed signups (compares vs clicks)
 *
 * Admin-gated via `isAdmin(user.email)`. Service-role client used for
 * the read (the click table is RLS-closed; users table has policies
 * but service role bypasses).
 *
 * Caching: NO edge cache. This route is admin-only + low traffic +
 * needs to reflect "just published" metrics during partner calls.
 * One DB query per request is fine.
 */
export async function GET() {
  // Admin gate — mirrors the pattern in app/admin/page.tsx
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const svc = createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Fire all 4 queries in parallel — they don't depend on each other,
  // and Supabase pools the connections.
  const [headlineRes, dailyRes, topDestRes, signupRes] = await Promise.all([
    svc.rpc("hostelworld_stats_30d", { since: thirtyDaysAgo }).single(),
    svc.rpc("hostelworld_stats_daily", { since: thirtyDaysAgo }),
    svc.rpc("hostelworld_top_destinations", { since: thirtyDaysAgo, max_rows: 10 }),
    // Signups attributed to Hostelworld in the last 30 days, grouped by day.
    // Can't easily express as an RPC over `users` without service-role
    // exposing the user list — do it as a plain SELECT with COUNT.
    svc
      .from("users")
      .select("created_at, id", { count: "exact" })
      .eq("acquisition_source", "hostelworld")
      .gte("created_at", thirtyDaysAgo),
  ]);

  if (headlineRes.error || dailyRes.error || topDestRes.error || signupRes.error) {
    console.error("[admin/hostelworld/stats] query errors:", {
      headline: headlineRes.error?.message,
      daily: dailyRes.error?.message,
      topDest: topDestRes.error?.message,
      signups: signupRes.error?.message,
    });
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  type HeadlineRow = { clicks_30d: number; unique_trips_30d: number; unique_visitors_30d: number };
  type DailyRow = {
    day: string;
    clicks: number;
    unique_visitors: number;
    unique_trips: number;
    mobile_clicks: number;
    desktop_clicks: number;
    tablet_clicks: number;
  };
  type TopDestRow = { destination: string; clicks: number; unique_visitors: number };
  const headline = (headlineRes.data ?? {}) as HeadlineRow;
  const daily = (dailyRes.data ?? []) as DailyRow[];
  const topDest = (topDestRes.data ?? []) as TopDestRow[];
  const signupRows = (signupRes.data ?? []) as Array<{ created_at: string; id: string }>;

  // Compute signup totals + per-day. Keep it simple: bucket on yyyy-mm-dd.
  const signupsByDay = new Map<string, number>();
  for (const s of signupRows) {
    const day = new Date(s.created_at).toISOString().slice(0, 10);
    signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1);
  }
  const dailyWithSignups = daily.map((d) => ({
    ...d,
    signups: signupsByDay.get(d.day) ?? 0,
  }));

  // Device totals across the window (for the donut/legend).
  const totalMobile = daily.reduce((a, d) => a + (d.mobile_clicks ?? 0), 0);
  const totalDesktop = daily.reduce((a, d) => a + (d.desktop_clicks ?? 0), 0);
  const totalTablet = daily.reduce((a, d) => a + (d.tablet_clicks ?? 0), 0);

  return NextResponse.json({
    windowDays: 30,
    headline: {
      clicks: headline.clicks_30d ?? 0,
      uniqueTrips: headline.unique_trips_30d ?? 0,
      uniqueVisitors: headline.unique_visitors_30d ?? 0,
      hostelworldSignups: signupRows.length,
    },
    daily: dailyWithSignups,
    topDestinations: topDest,
    deviceSplit: {
      mobile: totalMobile,
      desktop: totalDesktop,
      tablet: totalTablet,
    },
  });
}
