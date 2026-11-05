import { getAuthenticatedAdmin } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchActivationFunnel } from "@/lib/admin/activation-funnel";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logReadError } from "@/lib/supabase/log-read-error";
import { readWholeTable } from "@/lib/supabase/read-all-rows";
import { activationStats } from "@/lib/admin/stats/activation";
import {
  generationCosts,
  topDestinations,
  tripsByStatus,
  usageByAction,
  usageByModel,
  usageTotals,
  type AiUsageRow,
  type GeminiLog,
  type TripRow,
} from "@/lib/admin/stats/breakdowns";
import { fetchWoWDeltas } from "@/lib/admin/stats/deltas";
import { fetchAiMetricsDirect, fetchSubscriberMetricsDirect, fetchTripMetricsDirect, fetchUserMetricsDirect } from "@/lib/admin/stats/direct";
import { fetchGeoMetrics } from "@/lib/admin/stats/geo";
import { fetchRecentActivity } from "@/lib/admin/stats/recent-activity";
import { activityByUser, cohortRetention, type ActivityRow } from "@/lib/admin/stats/retention";
import type { AdminStats } from "@/lib/admin/stats/types";
import { userTrend } from "@/lib/admin/stats/user-trend";

// 28 days matches the window GA4 defaults to, so the two can be read
// side by side while GA4 still exists. Kept in one place because the API and
// the panel label must never disagree about what the number covers.
const ACQUISITION_WINDOW_DAYS = 28;

const NO_ROWS = { data: null, error: null };

/** A read the tab can go on without: if it throws, that's logged and the fallback stands in. */
function orElse<T, F>(label: string, read: PromiseLike<T>, fallback: F): Promise<T | F> {
  return Promise.resolve(read).catch((reason) => {
    console.error(`[Admin Stats] ${label} failed:`, reason);
    return fallback;
  });
}

export async function GET() {
  try {
    // 1. Verify the caller is an authenticated admin. This still uses the
    //    user-context client so the RLS-gated `users` row lookup and the
    //    isAdmin email check both work the way the rest of the app expects.
    const { errorResponse } = await getAuthenticatedAdmin();
    if (errorResponse) return errorResponse;

    // 2. THEN swap to the service-role client for every cross-user metric
    //    query below. The user-context client honours RLS on `trips`,
    //    `users`, `activity_timelines`, etc., so counts would cover only
    //    what the admin can see (no one else's private trips). The admin
    //    check above is the authorization boundary; past it, queries see
    //    the whole dataset.
    const supabase: SupabaseClient = createAdminClient();

    const [
      usersResult,
      tripsResult,
      aiUsageResult,
      aiConversationsResult,
      subscribersResult,
      tripRows,
      usageRows,
      geminiLogs,
      userRows,
      conversationRows,
      bananaRows,
      geoMetricsResult,
      acquisitionResult,
      engagementResult,
      timeToTripResult,
      recentActivityResult,
    ] = await Promise.all([
      orElse("user metrics", supabase.rpc("get_user_metrics"), { data: null }),
      orElse("trip metrics", supabase.rpc("get_trip_metrics"), { data: null }),
      orElse("AI usage metrics", supabase.rpc("get_ai_usage_metrics"), { data: null }),
      orElse("AI conversations", supabase.from("ai_conversations").select("id", { count: "exact", head: true }), { data: null, count: 0 }),
      orElse("subscriber metrics", supabase.rpc("get_subscriber_metrics"), { data: null }),
      orElse("trips", readWholeTable<TripRow>(supabase, "trips", "id, user_id, status, title, trip_meta, created_at"), NO_ROWS),
      orElse("AI usage", readWholeTable<AiUsageRow>(supabase, "ai_usage", "id, action, model_id, input_tokens, output_tokens, cost_cents"), NO_ROWS),
      // Generation costs: trip generation + regeneration.
      orElse(
        "Gemini calls",
        readWholeTable<GeminiLog>(supabase, "api_request_logs", "id, cost_usd, endpoint, response_status, cache_hit", (logs) => logs.eq("api_name", "gemini")),
        NO_ROWS
      ),
      orElse("users", readWholeTable<{ id: string; created_at: string }>(supabase, "users", "id, created_at"), NO_ROWS),
      orElse("conversation activity", readWholeTable<ActivityRow>(supabase, "ai_conversations", "id, user_id, created_at"), NO_ROWS),
      orElse("banana activity", readWholeTable<ActivityRow>(supabase, "banana_transactions", "id, user_id, created_at"), NO_ROWS),
      orElse("geo metrics", fetchGeoMetrics(supabase), null),
      // Entry channel per session, windowed. Counting sessions, not views, a reader
      // working through twelve blog pages doesn't outweigh twelve arrivals.
      orElse("acquisition", supabase.rpc("get_acquisition_breakdown", { p_days: ACQUISITION_WINDOW_DAYS }), { data: [] }),
      orElse("engagement", supabase.rpc("get_engagement_metrics"), { data: [] }),
      orElse("time to first trip", supabase.rpc("get_time_to_first_trip"), { data: [] }),
      orElse("recent activity", fetchRecentActivity(supabase), [] as AdminStats["recentActivity"]),
    ]);

    const trips = logReadError("admin stats: trips", tripRows).data ?? [];
    const usage = logReadError("admin stats: AI usage", usageRows).data ?? [];
    const users = logReadError("admin stats: users", userRows).data ?? [];
    const tokens = usageTotals(usage);
    const costs = generationCosts(logReadError("admin stats: Gemini calls", geminiLogs).data ?? []);

    // Fallback to direct queries if RPC doesn't exist
    const userMetrics = usersResult.data || (await fetchUserMetricsDirect(supabase));
    const tripMetrics = tripsResult.data || (await fetchTripMetricsDirect(supabase));
    const aiMetrics = aiUsageResult.data || (await fetchAiMetricsDirect(supabase));
    const subscriberMetrics = subscribersResult.data || (await fetchSubscriberMetricsDirect(supabase));

    // Calculate churn metrics
    const usersWithTripsCount = new Set(trips.map((t) => t.user_id)).size;
    const totalUsers = userMetrics.total || 0;
    const neverCreatedTrip = totalUsers - usersWithTripsCount;

    // Activity-proxy "active" signals. public.users.last_sign_in_at is never
    // synced from auth.users (always NULL), which silently zeroed
    // activeLast30Days, retention, at-risk and the cohort matrix. Derive
    // "active" from signals we DO record: trips, AI conversations, bananas.
    // (DAU/WAU/MAU still come from the get_engagement_metrics RPC and need a
    // migration to re-base — tracked separately.)
    const activity = activityByUser(
      trips,
      logReadError("admin stats: AI activity", conversationRows).data ?? [],
      logReadError("admin stats: banana activity", bananaRows).data ?? []
    );
    const t30 = Date.now() - 30 * 86_400_000;
    const t7 = Date.now() - 7 * 86_400_000;
    const activeUserIds7d = new Set<string>();
    let activeLast30Days = 0;
    for (const [uid, times] of activity) {
      if (times.some((t) => t >= t30)) activeLast30Days++;
      if (times.some((t) => t >= t7)) activeUserIds7d.add(uid);
    }
    const inactiveLast30Days = Math.max(totalUsers - activeLast30Days, 0);
    const retentionRate = totalUsers > 0 ? ((totalUsers - inactiveLast30Days) / totalUsers) * 100 : 0;

    const [deltas, activationFunnel] = await Promise.all([fetchWoWDeltas(supabase), fetchActivationFunnel(supabase)]);
    const activation = activationStats(
      tripRows,
      userRows,
      totalUsers,
      usersWithTripsCount,
      tripMetrics.total || 0,
      tripMetrics.sharedTrips || 0,
      activeUserIds7d
    );

    // Build response
    const stats: AdminStats = {
      users: {
        total: userMetrics.total || 0,
        newLast7Days: userMetrics.newLast7Days || 0,
        newLast30Days: userMetrics.newLast30Days || 0,
        activeLast30Days,
        withTrips: usersWithTripsCount,
        withoutTrips: neverCreatedTrip,
        deltaPctWoW: deltas.users,
      },
      activation,
      activationFunnel,
      churn: {
        neverCreatedTrip,
        inactiveLast30Days,
        retentionRate: Math.round(retentionRate * 10) / 10,
        cohortRetention: cohortRetention(users, activity),
      },
      trips: {
        total: tripMetrics.total || 0,
        byStatus: tripsByStatus(trips),
        last7Days: tripMetrics.last7Days || 0,
        last30Days: tripMetrics.last30Days || 0,
        averagePerUser: totalUsers > 0 ? Math.round((tripMetrics.total / totalUsers) * 10) / 10 : 0,
        sharedTrips: tripMetrics.sharedTrips || 0,
        deltaPctWoW: deltas.trips,
      },
      ai: {
        totalRequests: aiMetrics.total || 0,
        last7Days: aiMetrics.last7Days || 0,
        last30Days: aiMetrics.last30Days || 0,
        byAction: usageByAction(usage),
        byModel: usageByModel(usage),
        totalTokens: {
          input: tokens.inputTokens,
          output: tokens.outputTokens,
        },
        totalCostCents: tokens.costCents,
        conversationCount: aiConversationsResult.count || 0,
        generationCosts: {
          totalUsd: costs.totalCostUsd,
          tripGenerations: costs.generateCount,
          activityRegenerations: costs.regenerateCount,
        },
        // Combined: assistant costs (cents→USD) + generation costs (already USD)
        totalCostUsd:
          tokens.costCents / 100 + costs.totalCostUsd,
        deltaPctWoW: deltas.ai,
        costPerTripUsd: (tripMetrics.total || 0) > 0
          ? Math.round(
              ((tokens.costCents / 100 + costs.totalCostUsd) /
                (tripMetrics.total || 1)) * 10000
            ) / 10000
          : 0,
      },
      subscribers: {
        total: subscriberMetrics.total || 0,
        last7Days: subscriberMetrics.last7Days || 0,
        last30Days: subscriberMetrics.last30Days || 0,
        verified: subscriberMetrics.verified || 0,
        unsubscribed: subscriberMetrics.unsubscribed || 0,
      },
      geo: {
        ...(geoMetricsResult || {
          totalPageViews: 0,
          last7Days: 0,
          last30Days: 0,
          byCountry: [],
          byCity: [],
          topPages: [],
          uniqueVisitors: 0,
          // The whole geo fetch failed, so every zero below is missing data.
          // Saying so is the entire point of this field.
          degraded: ["geo_metrics_unavailable"],
          traffic: {
            daily: [],
            bySection: [],
            conversionFunnel: [],
          },
        }),
        deltaPctWoW: deltas.pageViews,
      },
      acquisition: {
        channels: (acquisitionResult.data || []).map(
          (r: {
            channel: string;
            entry_sessions: number;
            reached_wizard: number;
            wizard_pct: number;
            share_pct: number;
          }) => ({
            channel: r.channel,
            entrySessions: Number(r.entry_sessions),
            reachedWizard: Number(r.reached_wizard),
            wizardPct: Number(r.wizard_pct ?? 0),
            sharePct: Number(r.share_pct ?? 0),
          })
        ),
        windowDays: ACQUISITION_WINDOW_DAYS,
      },
      engagement: (() => {
        const eng = engagementResult.data?.[0] || { dau: 0, wau: 0, mau: 0, stickiness_pct: 0 };
        const ttt = timeToTripResult.data?.[0] || { avg_hours: 0, median_hours: 0, users_count: 0, within_1h: 0, within_24h: 0, within_7d: 0 };
        return {
          dau: Number(eng.dau) || 0,
          wau: Number(eng.wau) || 0,
          mau: Number(eng.mau) || 0,
          stickinessPct: Number(eng.stickiness_pct) || 0,
          timeToFirstTrip: {
            avgHours: Number(ttt.avg_hours) || 0,
            medianHours: Number(ttt.median_hours) || 0,
            usersCount: Number(ttt.users_count) || 0,
            within1h: Number(ttt.within_1h) || 0,
            within24h: Number(ttt.within_24h) || 0,
            within7d: Number(ttt.within_7d) || 0,
          },
        };
      })(),
      topDestinations: topDestinations(trips),
      recentActivity: recentActivityResult,
      userTrend: userTrend(users),
    };

    return apiSuccess(stats);
  } catch (error) {
    console.error("[Admin Stats] Error:", error);
    return errors.internal("Failed to fetch admin stats", "Admin Stats");
  }
}
