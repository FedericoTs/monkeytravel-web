import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminStats } from "./types";

// ISO country code to full name mapping
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  IT: "Italy",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  PT: "Portugal",
  GR: "Greece",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  CZ: "Czech Republic",
  IE: "Ireland",
  CA: "Canada",
  AU: "Australia",
  NZ: "New Zealand",
  JP: "Japan",
  CN: "China",
  KR: "South Korea",
  IN: "India",
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  CO: "Colombia",
  CL: "Chile",
  ZA: "South Africa",
  EG: "Egypt",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  IL: "Israel",
  TR: "Turkey",
  RU: "Russia",
  UA: "Ukraine",
  SG: "Singapore",
  MY: "Malaysia",
  TH: "Thailand",
  VN: "Vietnam",
  ID: "Indonesia",
  PH: "Philippines",
};

function getCountryName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}

// Fetch geo metrics from page_views table using proper SQL COUNT queries
// This avoids the Supabase 1000 row default limit.
// deltaPctWoW is injected by the caller (computed in fetchWoWDeltas).
export async function fetchGeoMetrics(
  supabase: SupabaseClient,
): Promise<Omit<AdminStats["geo"], "deltaPctWoW">> {
  // Use parallel queries with proper COUNT to avoid 1000 row limit
  const [
    totalsResult,
    uniqueVisitorsResult,
    byCountryResult,
    byCityResult,
    topPagesResult,
    dailyTrendResult,
    bySectionResult,
    conversionFunnelResult,
    engagedDailyResult,
  ] = await Promise.all([
    // Total / 7d / 30d page views.
    //
    // These were three count(*) scans over page_views, each taking seconds
    // uncontended: the all-time count alone came close to the 8s
    // statement_timeout, and all of them ran inside this same Promise.all.
    // They now read the daily rollup.
    //
    // The 7d/30d windows are CALENDAR days now, not rolling 168/720-hour
    // windows; a daily rollup has no sub-day resolution. The all-time total is
    // unchanged and exact.
    supabase.rpc("get_page_view_totals"),

    // Unique visitors (fingerprint-based approximation)
    supabase.rpc("count_unique_visitors"),

    // By country - use RPC function for aggregation
    supabase.rpc("get_page_views_by_country"),

    // By city - use RPC function for aggregation
    supabase.rpc("get_page_views_by_city"),

    // Top pages - use RPC function (normalized paths)
    supabase.rpc("get_top_pages"),

    // Daily traffic trend (last 90 days)
    supabase.rpc("get_page_views_daily_trend"),

    // Traffic by app section
    supabase.rpc("get_page_views_by_section"),

    // Conversion funnel
    supabase.rpc("get_conversion_funnel"),

    // Engaged sessions per day. Sits beside uniqueVisitors because most of the
    // sessions counted there never keep a page visible for four seconds and
    // rarely reach the wizard, so the raw line overstates plausible prospects.
    supabase.rpc("get_engaged_sessions_daily"),
  ]);

  // A metric reading zero must never be indistinguishable from a failed query.
  //
  // Every consumer below reads `(x.data || [])`, so a timed-out RPC silently
  // became an empty array and the dashboard rendered "no traffic".
  // PostgREST connects as `authenticator`, which carries statement_timeout=8s,
  // so no amount of global timeout helps.
  //
  // Name every failure loudly, and hand the caller a `degraded` list so the UI
  // can say "unavailable" instead of drawing a confident zero.
  const degraded: string[] = [];
  for (const [name, result] of [
    ["page_view_totals", totalsResult],
    ["unique_visitors", uniqueVisitorsResult],
    ["by_country", byCountryResult],
    ["by_city", byCityResult],
    ["top_pages", topPagesResult],
    ["daily_trend", dailyTrendResult],
    ["by_section", bySectionResult],
    ["conversion_funnel", conversionFunnelResult],
    ["engaged_sessions_daily", engagedDailyResult],
  ] as const) {
    const err = (result as { error?: { message?: string; code?: string } }).error;
    if (!err) continue;
    degraded.push(name);
    // 57014 is the statement timeout. Call it out by name: it means the query
    // needs bounding, not retrying.
    console.error(
      `[admin/stats] GEO METRIC FAILED - ${name}: ${err.code ?? "?"} ${err.message ?? "unknown"}` +
        (err.code === "57014" ? " (statement timeout - the query exceeded 8s)" : "")
    );
    import("@sentry/nextjs")
      .then((Sentry) =>
        Sentry.captureMessage?.(`admin stats geo metric failed: ${name}`, {
          level: "error",
          tags: { source: "admin-stats", metric: name, pg_code: err.code },
        })
      )
      .catch(() => {});
  }

  const totalsRow = Array.isArray(totalsResult.data) ? totalsResult.data[0] : undefined;
  const totalPageViews = Number(totalsRow?.total_views) || 0;
  const last7Days = Number(totalsRow?.last_7_days) || 0;
  const last30Days = Number(totalsRow?.last_30_days) || 0;

  // Pre-aggregation adds a failure mode the live queries never had: if the
  // nightly pg_cron job stops, every geo number keeps rendering at full
  // confidence while quietly ageing. Same class of bug as a timed-out query
  // returning [].
  //
  // The job runs daily at 02:40 UTC and rebuilds 3 days each time, so one
  // missed night self-heals and is not worth alarming about. Two consecutive
  // misses is a real outage.
  const refreshedAt = totalsRow?.refreshed_at ? new Date(totalsRow.refreshed_at) : null;
  const rollupAgeHours = refreshedAt
    ? (Date.now() - refreshedAt.getTime()) / 36e5
    : Number.POSITIVE_INFINITY;
  if (rollupAgeHours > 36) {
    degraded.push("page_view_rollup_stale");
    console.error(
      `[admin/stats] PAGE VIEW ROLLUP STALE - last refreshed ${
        refreshedAt ? refreshedAt.toISOString() : "never"
      } (${Math.round(rollupAgeHours)}h ago); check: SELECT * FROM cron.job_run_details ORDER BY start_time DESC`
    );
  }

  // Extract unique visitors from RPC result (returns array with {count: number})
  let uniqueVisitors = 0;
  if (uniqueVisitorsResult.data && Array.isArray(uniqueVisitorsResult.data) && uniqueVisitorsResult.data.length > 0) {
    uniqueVisitors = Number(uniqueVisitorsResult.data[0].count) || 0;
  }

  // Process country data from RPC (no fallback - real data only)
  const byCountry: AdminStats["geo"]["byCountry"] = (byCountryResult.data || [])
    .slice(0, 10)
    .map((c: { country_code: string; count: number }) => ({
      country: getCountryName(c.country_code),
      countryCode: c.country_code,
      count: Number(c.count),
      percentage: totalPageViews > 0 ? Math.round((Number(c.count) / totalPageViews) * 1000) / 10 : 0,
    }));

  // Process city data from RPC (no fallback - real data only)
  const byCity: AdminStats["geo"]["byCity"] = (byCityResult.data || [])
    .slice(0, 10)
    .map((c: { city: string; country_code: string; count: number }) => ({
      city: c.city,
      country: getCountryName(c.country_code),
      count: Number(c.count),
    }));

  // Process top pages data from RPC (no fallback - real data only)
  const topPages: AdminStats["geo"]["topPages"] = (topPagesResult.data || [])
    .slice(0, 10)
    .map((p: { path: string; count: number }) => ({
      path: p.path,
      count: Number(p.count),
    }));

  // Process daily traffic trend.
  //
  // The engaged series is merged by date and deliberately left UNDEFINED for
  // days the beacon did not cover. Defaulting it to 0 would draw a cliff at the
  // first covered day, an artefact of when measurement started, not of
  // anything that happened to the traffic.
  const engagedByDate = new Map<string, number>(
    (engagedDailyResult.data || []).map((e: { date: string; engaged_sessions: number }) => [
      e.date,
      Number(e.engaged_sessions),
    ])
  );
  const daily: AdminStats["geo"]["traffic"]["daily"] = (dailyTrendResult.data || [])
    .map((d: { date: string; views: number; unique_visitors: number }) => ({
      date: d.date,
      views: Number(d.views),
      uniqueVisitors: Number(d.unique_visitors),
      ...(engagedByDate.has(d.date) ? { engagedSessions: engagedByDate.get(d.date) } : {}),
    }));

  // Process section breakdown.
  //
  // `unique_visitors` was dropped from get_page_views_by_section: nothing ever
  // rendered it (TrafficOverview reads only `count`), and computing it forced
  // a COUNT(DISTINCT) whose sort spilled 23MB to disk and took the RPC to
  // 25.5s -- past the 8s statement_timeout, so the panel showed nothing at all.
  const bySection: AdminStats["geo"]["traffic"]["bySection"] = (bySectionResult.data || [])
    .map((s: { section: string; count: number }) => ({
      section: s.section,
      count: Number(s.count),
    }));

  // Process conversion funnel
  const conversionFunnel: AdminStats["geo"]["traffic"]["conversionFunnel"] = (conversionFunnelResult.data || [])
    .map((f: { step: string; count: number }) => ({
      step: f.step,
      count: Number(f.count),
    }));

  return {
    totalPageViews,
    last7Days,
    last30Days,
    byCountry,
    byCity,
    topPages,
    uniqueVisitors,
    degraded,
    traffic: {
      daily,
      bySection,
      conversionFunnel,
    },
  };
}
