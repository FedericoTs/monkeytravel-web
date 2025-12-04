import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

// Cohort retention data for matrix visualization
export interface CohortData {
  cohort: string; // Week label (e.g., "Nov 25" or "Week 48")
  cohortSize: number; // Users who signed up in this cohort
  retention: number[]; // Retention % for Week 0, Week 1, etc.
}

export interface AdminStats {
  // User Metrics
  users: {
    total: number;
    newLast7Days: number;
    newLast30Days: number;
    activeLast30Days: number;
    withTrips: number;
    withoutTrips: number;
  };
  // Churn Metrics
  churn: {
    neverCreatedTrip: number;
    inactiveLast30Days: number;
    retentionRate: number;
    cohortRetention: CohortData[]; // Weekly cohort retention matrix
  };
  // Trip Metrics
  trips: {
    total: number;
    byStatus: Record<string, number>;
    last7Days: number;
    last30Days: number;
    averagePerUser: number;
    sharedTrips: number;
  };
  // AI Usage Metrics
  ai: {
    totalRequests: number;
    last7Days: number;
    last30Days: number;
    byAction: Record<string, number>;
    byModel: Record<string, number>;
    totalTokens: { input: number; output: number };
    totalCostCents: number;
    conversationCount: number;
  };
  // Email Subscribers
  subscribers: {
    total: number;
    last7Days: number;
    last30Days: number;
    verified: number;
    unsubscribed: number;
  };
  // Geo/Analytics - Page Views by Country
  geo: {
    totalPageViews: number;
    last7Days: number;
    last30Days: number;
    byCountry: { country: string; countryCode: string; count: number; percentage: number }[];
    byCity: { city: string; country: string; count: number }[];
    topPages: { path: string; count: number }[];
    uniqueVisitors: number;
  };
  // Top Destinations
  topDestinations: { destination: string; count: number }[];
  // Recent Activity Timeline
  recentActivity: {
    type: "user" | "trip" | "ai" | "subscriber";
    description: string;
    timestamp: string;
  }[];
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch all metrics in parallel
    const [
      usersResult,
      tripsResult,
      aiUsageResult,
      aiConversationsResult,
      subscribersResult,
      usersWithTripsResult,
      tripStatusResult,
      aiActionResult,
      aiModelResult,
      aiTokensResult,
      topDestinationsResult,
      geoMetricsResult,
    ] = await Promise.all([
      // User counts
      supabase.rpc("get_user_metrics"),
      // Trip counts
      supabase.rpc("get_trip_metrics"),
      // AI usage counts
      supabase.rpc("get_ai_usage_metrics"),
      // AI conversations count
      supabase.from("ai_conversations").select("id", { count: "exact" }),
      // Subscriber counts
      supabase.rpc("get_subscriber_metrics"),
      // Users with trips
      supabase.from("trips").select("user_id").then((res) => {
        const uniqueUsers = new Set(res.data?.map((t) => t.user_id) || []);
        return { count: uniqueUsers.size };
      }),
      // Trip by status
      supabase
        .from("trips")
        .select("status")
        .then((res) => {
          const counts: Record<string, number> = {};
          res.data?.forEach((t) => {
            counts[t.status] = (counts[t.status] || 0) + 1;
          });
          return { data: counts };
        }),
      // AI by action
      supabase
        .from("ai_usage")
        .select("action")
        .then((res) => {
          const counts: Record<string, number> = {};
          res.data?.forEach((a) => {
            counts[a.action] = (counts[a.action] || 0) + 1;
          });
          return { data: counts };
        }),
      // AI by model
      supabase
        .from("ai_usage")
        .select("model_id")
        .then((res) => {
          const counts: Record<string, number> = {};
          res.data?.forEach((a) => {
            counts[a.model_id] = (counts[a.model_id] || 0) + 1;
          });
          return { data: counts };
        }),
      // AI tokens total
      supabase
        .from("ai_usage")
        .select("input_tokens, output_tokens, cost_cents")
        .then((res) => {
          let inputTokens = 0;
          let outputTokens = 0;
          let costCents = 0;
          res.data?.forEach((a) => {
            inputTokens += a.input_tokens || 0;
            outputTokens += a.output_tokens || 0;
            costCents += Number(a.cost_cents) || 0;
          });
          return { data: { inputTokens, outputTokens, costCents } };
        }),
      // Top destinations
      supabase
        .from("trips")
        .select("title")
        .then((res) => {
          const counts: Record<string, number> = {};
          res.data?.forEach((t) => {
            const dest = t.title.replace(/ Trip$/, "");
            counts[dest] = (counts[dest] || 0) + 1;
          });
          return Object.entries(counts)
            .map(([destination, count]) => ({ destination, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        }),
      // Geo metrics from page_views
      fetchGeoMetrics(supabase),
    ]);

    // Fallback to direct queries if RPC doesn't exist
    const userMetrics = usersResult.data || (await fetchUserMetricsDirect(supabase));
    const tripMetrics = tripsResult.data || (await fetchTripMetricsDirect(supabase));
    const aiMetrics = aiUsageResult.data || (await fetchAiMetricsDirect(supabase));
    const subscriberMetrics = subscribersResult.data || (await fetchSubscriberMetricsDirect(supabase));

    // Calculate churn metrics
    const usersWithTripsCount = usersWithTripsResult.count || 0;
    const totalUsers = userMetrics.total || 0;
    const neverCreatedTrip = totalUsers - usersWithTripsCount;
    const inactiveLast30Days = totalUsers - (userMetrics.activeLast30Days || 0);
    const retentionRate = totalUsers > 0 ? ((totalUsers - inactiveLast30Days) / totalUsers) * 100 : 0;

    // Build response
    const stats: AdminStats = {
      users: {
        total: userMetrics.total || 0,
        newLast7Days: userMetrics.newLast7Days || 0,
        newLast30Days: userMetrics.newLast30Days || 0,
        activeLast30Days: userMetrics.activeLast30Days || 0,
        withTrips: usersWithTripsCount,
        withoutTrips: neverCreatedTrip,
      },
      churn: {
        neverCreatedTrip,
        inactiveLast30Days,
        retentionRate: Math.round(retentionRate * 10) / 10,
        cohortRetention: await fetchCohortRetention(supabase),
      },
      trips: {
        total: tripMetrics.total || 0,
        byStatus: tripStatusResult.data || {},
        last7Days: tripMetrics.last7Days || 0,
        last30Days: tripMetrics.last30Days || 0,
        averagePerUser: totalUsers > 0 ? Math.round((tripMetrics.total / totalUsers) * 10) / 10 : 0,
        sharedTrips: tripMetrics.sharedTrips || 0,
      },
      ai: {
        totalRequests: aiMetrics.total || 0,
        last7Days: aiMetrics.last7Days || 0,
        last30Days: aiMetrics.last30Days || 0,
        byAction: aiActionResult.data || {},
        byModel: aiModelResult.data || {},
        totalTokens: {
          input: aiTokensResult.data?.inputTokens || 0,
          output: aiTokensResult.data?.outputTokens || 0,
        },
        totalCostCents: aiTokensResult.data?.costCents || 0,
        conversationCount: aiConversationsResult.count || 0,
      },
      subscribers: {
        total: subscriberMetrics.total || 0,
        last7Days: subscriberMetrics.last7Days || 0,
        last30Days: subscriberMetrics.last30Days || 0,
        verified: subscriberMetrics.verified || 0,
        unsubscribed: subscriberMetrics.unsubscribed || 0,
      },
      geo: geoMetricsResult || {
        totalPageViews: 0,
        last7Days: 0,
        last30Days: 0,
        byCountry: [],
        byCity: [],
        topPages: [],
        uniqueVisitors: 0,
      },
      topDestinations: topDestinationsResult || [],
      recentActivity: await fetchRecentActivity(supabase),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch admin stats" },
      { status: 500 }
    );
  }
}

// Direct query fallbacks if RPC functions don't exist
async function fetchUserMetricsDirect(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: users } = await supabase.from("users").select("id, created_at, last_sign_in_at");
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: users?.length || 0,
    newLast7Days: users?.filter((u) => new Date(u.created_at) > day7Ago).length || 0,
    newLast30Days: users?.filter((u) => new Date(u.created_at) > day30Ago).length || 0,
    activeLast30Days: users?.filter((u) => u.last_sign_in_at && new Date(u.last_sign_in_at) > day30Ago).length || 0,
  };
}

async function fetchTripMetricsDirect(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: trips } = await supabase.from("trips").select("id, created_at, share_token");
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: trips?.length || 0,
    last7Days: trips?.filter((t) => new Date(t.created_at) > day7Ago).length || 0,
    last30Days: trips?.filter((t) => new Date(t.created_at) > day30Ago).length || 0,
    sharedTrips: trips?.filter((t) => t.share_token).length || 0,
  };
}

async function fetchAiMetricsDirect(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: usage } = await supabase.from("ai_usage").select("id, created_at");
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: usage?.length || 0,
    last7Days: usage?.filter((u) => new Date(u.created_at) > day7Ago).length || 0,
    last30Days: usage?.filter((u) => new Date(u.created_at) > day30Ago).length || 0,
  };
}

async function fetchSubscriberMetricsDirect(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: subs } = await supabase.from("email_subscribers").select("id, subscribed_at, verified, unsubscribed_at");
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    total: subs?.length || 0,
    last7Days: subs?.filter((s) => new Date(s.subscribed_at) > day7Ago).length || 0,
    last30Days: subs?.filter((s) => new Date(s.subscribed_at) > day30Ago).length || 0,
    verified: subs?.filter((s) => s.verified).length || 0,
    unsubscribed: subs?.filter((s) => s.unsubscribed_at).length || 0,
  };
}

async function fetchRecentActivity(supabase: Awaited<ReturnType<typeof createClient>>) {
  const activities: AdminStats["recentActivity"] = [];

  // Recent users
  const { data: recentUsers } = await supabase
    .from("users")
    .select("email, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  recentUsers?.forEach((u) => {
    activities.push({
      type: "user",
      description: `New user: ${u.email}`,
      timestamp: u.created_at,
    });
  });

  // Recent trips
  const { data: recentTrips } = await supabase
    .from("trips")
    .select("title, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  recentTrips?.forEach((t) => {
    activities.push({
      type: "trip",
      description: `New trip: ${t.title}`,
      timestamp: t.created_at,
    });
  });

  // Recent AI usage
  const { data: recentAi } = await supabase
    .from("ai_usage")
    .select("action, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  recentAi?.forEach((a) => {
    activities.push({
      type: "ai",
      description: `AI action: ${a.action}`,
      timestamp: a.created_at,
    });
  });

  // Sort by timestamp and return top 15
  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);
}

// Cohort retention matrix - tracks weekly user retention
async function fetchCohortRetention(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CohortData[]> {
  // Get all users with their signup and last activity dates
  const { data: users } = await supabase
    .from("users")
    .select("id, created_at, last_sign_in_at")
    .order("created_at", { ascending: true });

  if (!users || users.length === 0) return [];

  // Group users by signup week
  const cohorts = new Map<string, { users: typeof users; weekStart: Date }>();
  const now = new Date();

  users.forEach((user) => {
    const signupDate = new Date(user.created_at);
    // Get the Monday of the signup week
    const weekStart = getWeekStart(signupDate);
    const weekKey = weekStart.toISOString().split("T")[0];

    if (!cohorts.has(weekKey)) {
      cohorts.set(weekKey, { users: [], weekStart });
    }
    cohorts.get(weekKey)!.users.push(user);
  });

  // Calculate retention for each cohort
  const cohortData: CohortData[] = [];
  const sortedCohorts = Array.from(cohorts.entries()).sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
  );

  // Only show last 8 cohorts for readability
  const recentCohorts = sortedCohorts.slice(-8);

  recentCohorts.forEach(([weekKey, { users: cohortUsers, weekStart }]) => {
    const cohortSize = cohortUsers.length;
    const retention: number[] = [];

    // Calculate weeks since cohort started
    const weeksSinceCohort = Math.floor(
      (now.getTime() - weekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    // Calculate retention for each week (Week 0 to current week)
    for (let week = 0; week <= Math.min(weeksSinceCohort, 7); week++) {
      const weekEnd = new Date(weekStart.getTime() + (week + 1) * 7 * 24 * 60 * 60 * 1000);

      // Count users who were active during or after this week
      const activeUsers = cohortUsers.filter((user) => {
        if (!user.last_sign_in_at) return week === 0; // Count as active only in week 0 if never signed in again
        const lastActive = new Date(user.last_sign_in_at);
        return lastActive >= weekStart && lastActive >= new Date(weekStart.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      }).length;

      const retentionPct = cohortSize > 0 ? Math.round((activeUsers / cohortSize) * 100) : 0;
      retention.push(retentionPct);
    }

    // Format cohort label (e.g., "Nov 25")
    const cohortLabel = weekStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    cohortData.push({
      cohort: cohortLabel,
      cohortSize,
      retention,
    });
  });

  return cohortData;
}

// Helper: Get Monday of the week for a given date
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

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
// This avoids the Supabase 1000 row default limit
async function fetchGeoMetrics(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AdminStats["geo"]> {
  const now = new Date();
  const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Use parallel queries with proper COUNT to avoid 1000 row limit
  const [
    totalCountResult,
    last7DaysResult,
    last30DaysResult,
    uniqueVisitorsResult,
    byCountryResult,
    byCityResult,
    topPagesResult,
  ] = await Promise.all([
    // Total page views count
    supabase.from("page_views").select("id", { count: "exact", head: true }),

    // Last 7 days count
    supabase
      .from("page_views")
      .select("id", { count: "exact", head: true })
      .gte("created_at", day7Ago),

    // Last 30 days count
    supabase
      .from("page_views")
      .select("id", { count: "exact", head: true })
      .gte("created_at", day30Ago),

    // Unique visitors (count distinct session_id)
    supabase.rpc("count_unique_visitors"),

    // By country - use RPC function for aggregation
    supabase.rpc("get_page_views_by_country"),

    // By city - use RPC function for aggregation
    supabase.rpc("get_page_views_by_city"),

    // Top pages - use RPC function for aggregation
    supabase.rpc("get_top_pages"),
  ]);

  const totalPageViews = totalCountResult.count || 0;
  const last7Days = last7DaysResult.count || 0;
  const last30Days = last30DaysResult.count || 0;

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

  return {
    totalPageViews,
    last7Days,
    last30Days,
    byCountry,
    byCity,
    topPages,
    uniqueVisitors,
  };
}
