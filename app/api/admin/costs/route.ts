import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { API_COSTS } from "@/lib/api-gateway/config";
import { circuitBreakerManager } from "@/lib/api-gateway";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * Enhanced Cost Analytics API
 *
 * Provides comprehensive metrics from the API Gateway including:
 * - Cost breakdowns by API, user, and time period
 * - Performance metrics (latency percentiles, error rates)
 * - Circuit breaker status
 * - Cache performance
 * - Real-time activity feed
 */

export interface EnhancedCostAnalytics {
  // Summary metrics
  summary: {
    totalCostUsd: number;
    todayCostUsd: number;
    last7DaysCostUsd: number;
    last30DaysCostUsd: number;
    totalRequests: number;
    todayRequests: number;
    avgCostPerRequest: number;
    projectedMonthlyCost: number;
  };

  // Performance metrics
  performance: {
    avgResponseTimeMs: number;
    p50ResponseTimeMs: number;
    p95ResponseTimeMs: number;
    p99ResponseTimeMs: number;
    errorRate: number;
    totalErrors: number;
    successRate: number;
  };

  // Cache performance
  cache: {
    hitRate: number;
    totalHits: number;
    totalMisses: number;
    estimatedSavingsUsd: number;
    byType: {
      geocode: { entries: number; hits: number };
      distance: { entries: number; hits: number };
      places: { entries: number; hits: number };
      activities: { entries: number; hits: number };
    };
  };

  // Circuit breaker status for each API
  circuitBreakers: {
    apiName: string;
    state: "CLOSED" | "OPEN" | "HALF_OPEN";
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  }[];

  // Cost breakdown by API
  byApi: {
    apiName: string;
    displayName: string;
    totalCost: number;
    requestCount: number;
    cacheHits: number;
    cacheMisses: number;
    errorCount: number;
    errorRate: number;
    avgResponseTimeMs: number;
    color: string;
  }[];

  // Per-user cost breakdown (top 10)
  byUser: {
    userId: string;
    email?: string;
    totalCost: number;
    requestCount: number;
  }[];

  // Daily trend (last 30 days)
  dailyTrend: {
    date: string;
    cost: number;
    requests: number;
    cacheHits: number;
    errors: number;
  }[];

  // Hourly trend (last 24 hours)
  hourlyTrend: {
    hour: string;
    cost: number;
    requests: number;
    avgLatency: number;
  }[];

  // Top expensive endpoints
  topEndpoints: {
    endpoint: string;
    apiName: string;
    cost: number;
    count: number;
    avgLatency: number;
  }[];

  // Recent activity (last 50 requests)
  recentActivity: {
    id: string;
    timestamp: string;
    apiName: string;
    endpoint: string;
    status: number;
    responseTimeMs: number;
    costUsd: number;
    cacheHit: boolean;
    error?: string;
  }[];

  // Timestamp
  generatedAt: string;
}

// Backward compatibility alias for old CostDashboard
export type CostAnalytics = EnhancedCostAnalytics;

// API display names and colors for the dashboard
const API_DISPLAY_CONFIG: Record<string, { name: string; color: string }> = {
  google_places_search: { name: "Places Search", color: "#4285F4" },
  google_places_autocomplete: { name: "Autocomplete", color: "#34A853" },
  google_places_details: { name: "Place Details", color: "#FBBC05" },
  google_places_nearby: { name: "Nearby Search", color: "#EA4335" },
  google_geocoding: { name: "Geocoding", color: "#7B1FA2" },
  google_distance_matrix: { name: "Distance Matrix", color: "#00ACC1" },
  gemini_generate: { name: "Gemini Generate", color: "#FF6D00" },
  gemini_regenerate: { name: "Gemini Regen", color: "#FF9100" },
  gemini: { name: "Gemini AI", color: "#FF6D00" },
  open_meteo: { name: "Weather", color: "#29B6F6" },
  pexels: { name: "Pexels", color: "#05A081" },
  amadeus_flights: { name: "Amadeus Flights", color: "#1565C0" },
  amadeus_hotels: { name: "Amadeus Hotels", color: "#6A1B9A" },
  amadeus_locations: { name: "Amadeus Locations", color: "#00838F" },
};

function getApiDisplay(apiName: string) {
  return API_DISPLAY_CONFIG[apiName] || { name: apiName, color: "#78909C" };
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Check admin access
    if (!isAdmin(user.email)) {
      return errors.forbidden();
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const hours24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Fetch all data in parallel
    const [
      allLogsResult,
      todayLogsResult,
      last7DaysLogsResult,
      last30DaysLogsResult,
      recentLogsResult,
      geocodeCacheResult,
      distanceCacheResult,
      placesCacheResult,
      activitiesCacheResult,
      userStatsResult,
    ] = await Promise.all([
      // All API request logs with full data
      supabase
        .from("api_request_logs")
        .select("id, api_name, endpoint, cost_usd, cache_hit, timestamp, response_status, response_time_ms, error_message, user_id")
        .order("timestamp", { ascending: false }),

      // Today's logs
      supabase
        .from("api_request_logs")
        .select("cost_usd, response_status")
        .gte("timestamp", todayStart),

      // Last 7 days logs
      supabase
        .from("api_request_logs")
        .select("cost_usd")
        .gte("timestamp", day7Ago),

      // Last 30 days logs
      supabase
        .from("api_request_logs")
        .select("cost_usd")
        .gte("timestamp", day30Ago),

      // Recent logs for activity feed (last 50)
      supabase
        .from("api_request_logs")
        .select("id, api_name, endpoint, cost_usd, cache_hit, timestamp, response_status, response_time_ms, error_message")
        .order("timestamp", { ascending: false })
        .limit(50),

      // Geocode cache stats
      supabase
        .from("geocode_cache")
        .select("hit_count"),

      // Distance cache stats
      supabase
        .from("distance_cache")
        .select("hit_count"),

      // Places cache stats
      supabase
        .from("google_places_cache")
        .select("hit_count, cache_type"),

      // Activities cache stats
      supabase
        .from("destination_activity_cache")
        .select("hit_count"),

      // Get user data for cost attribution
      supabase
        .from("users")
        .select("id, email"),
    ]);

    const allLogs = allLogsResult.data || [];
    const todayLogs = todayLogsResult.data || [];
    const last7DaysLogs = last7DaysLogsResult.data || [];
    const last30DaysLogs = last30DaysLogsResult.data || [];
    const recentLogs = recentLogsResult.data || [];
    const geocodeCache = geocodeCacheResult.data || [];
    const distanceCache = distanceCacheResult.data || [];
    const placesCache = placesCacheResult.data || [];
    const activitiesCache = activitiesCacheResult.data || [];
    const users = userStatsResult.data || [];

    // Create user lookup map
    const userMap = new Map(users.map(u => [u.id, u.email]));

    // Calculate summary metrics
    const totalCostUsd = allLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const todayCostUsd = todayLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const last7DaysCostUsd = last7DaysLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const last30DaysCostUsd = last30DaysLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const avgCostPerRequest = allLogs.length > 0 ? totalCostUsd / allLogs.length : 0;

    // Project monthly cost based on last 7 days
    const projectedMonthlyCost = (last7DaysCostUsd / 7) * 30;

    // Performance metrics
    const responseTimes = allLogs
      .map(l => Number(l.response_time_ms))
      .filter(t => t > 0);

    const avgResponseTimeMs = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const errorLogs = allLogs.filter(l => (l.response_status || 0) >= 400 || l.error_message);
    const errorRate = allLogs.length > 0 ? (errorLogs.length / allLogs.length) * 100 : 0;

    // Calculate cache stats
    const geocodeHits = geocodeCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const distanceHits = distanceCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const placesHits = placesCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const activitiesHits = activitiesCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const totalCacheHits = geocodeHits + distanceHits + placesHits + activitiesHits;

    // Cache hit/miss from logs
    const cacheHitsFromLogs = allLogs.filter(l => l.cache_hit).length;
    const cacheMissesFromLogs = allLogs.filter(l => !l.cache_hit).length;
    const hitRate = allLogs.length > 0
      ? (cacheHitsFromLogs / allLogs.length) * 100
      : 0;

    // Estimate savings - use ONLY cache table hits (not logs) to avoid double-counting
    // Cache table hit_count = how many times cached data was served (actual savings)
    // Log cache_hit = whether the API call used cache (already reflected in cost_usd=0)
    const avgApiCost = 0.01;
    const estimatedSavingsUsd = totalCacheHits * avgApiCost;

    // Get circuit breaker status
    const circuitBreakerStats = circuitBreakerManager.getAllStats();
    const circuitBreakers = Object.entries(circuitBreakerStats).map(([apiName, stats]) => ({
      apiName,
      state: stats.state,
      failureCount: stats.failureCount,
      successCount: stats.successCount,
      lastFailureTime: stats.lastFailureTime,
    }));

    // Add default circuit breakers for known APIs that haven't been used yet
    const knownApis = Object.keys(API_COSTS);
    const trackedApis = new Set(circuitBreakers.map(cb => cb.apiName));
    knownApis.forEach(api => {
      if (!trackedApis.has(api)) {
        circuitBreakers.push({
          apiName: api,
          state: "CLOSED",
          failureCount: 0,
          successCount: 0,
          lastFailureTime: 0,
        });
      }
    });

    // Group by API with enhanced metrics
    const byApiMap = new Map<string, {
      cost: number;
      count: number;
      hits: number;
      misses: number;
      errors: number;
      responseTimes: number[];
    }>();

    allLogs.forEach(log => {
      const apiName = log.api_name || "unknown";
      const current = byApiMap.get(apiName) || {
        cost: 0,
        count: 0,
        hits: 0,
        misses: 0,
        errors: 0,
        responseTimes: [],
      };
      current.cost += Number(log.cost_usd) || 0;
      current.count += 1;
      if (log.cache_hit) current.hits += 1;
      else current.misses += 1;
      if ((log.response_status || 0) >= 400 || log.error_message) current.errors += 1;
      if (log.response_time_ms && log.response_time_ms > 0) {
        current.responseTimes.push(Number(log.response_time_ms));
      }
      byApiMap.set(apiName, current);
    });

    const byApi = Array.from(byApiMap.entries())
      .map(([apiName, data]) => {
        const display = getApiDisplay(apiName);
        const avgTime = data.responseTimes.length > 0
          ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length
          : 0;
        return {
          apiName,
          displayName: display.name,
          totalCost: Math.round(data.cost * 1000) / 1000,
          requestCount: data.count,
          cacheHits: data.hits,
          cacheMisses: data.misses,
          errorCount: data.errors,
          errorRate: data.count > 0 ? Math.round((data.errors / data.count) * 1000) / 10 : 0,
          avgResponseTimeMs: Math.round(avgTime),
          color: display.color,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);

    // Per-user cost breakdown (top 10)
    const byUserMap = new Map<string, { cost: number; count: number }>();
    allLogs.forEach(log => {
      if (!log.user_id) return;
      const current = byUserMap.get(log.user_id) || { cost: 0, count: 0 };
      current.cost += Number(log.cost_usd) || 0;
      current.count += 1;
      byUserMap.set(log.user_id, current);
    });

    const byUser = Array.from(byUserMap.entries())
      .map(([userId, data]) => ({
        userId,
        email: userMap.get(userId),
        totalCost: Math.round(data.cost * 1000) / 1000,
        requestCount: data.count,
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10);

    // Daily trend (last 30 days)
    const dailyMap = new Map<string, { cost: number; requests: number; cacheHits: number; errors: number }>();
    for (let i = 0; i < 30; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split("T")[0];
      dailyMap.set(dateStr, { cost: 0, requests: 0, cacheHits: 0, errors: 0 });
    }

    allLogs.forEach(log => {
      if (!log.timestamp) return;
      const dateStr = new Date(log.timestamp).toISOString().split("T")[0];
      if (dailyMap.has(dateStr)) {
        const current = dailyMap.get(dateStr)!;
        current.cost += Number(log.cost_usd) || 0;
        current.requests += 1;
        if (log.cache_hit) current.cacheHits += 1;
        if ((log.response_status || 0) >= 400 || log.error_message) current.errors += 1;
      }
    });

    const dailyTrend = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        cost: Math.round(data.cost * 1000) / 1000,
        requests: data.requests,
        cacheHits: data.cacheHits,
        errors: data.errors,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Hourly trend (last 24 hours)
    const hourlyMap = new Map<string, { cost: number; requests: number; totalLatency: number; count: number }>();
    for (let i = 0; i < 24; i++) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourStr = hour.toISOString().slice(0, 13);
      hourlyMap.set(hourStr, { cost: 0, requests: 0, totalLatency: 0, count: 0 });
    }

    allLogs.forEach(log => {
      if (!log.timestamp) return;
      const logTime = new Date(log.timestamp);
      if (logTime.getTime() < now.getTime() - 24 * 60 * 60 * 1000) return;

      const hourStr = logTime.toISOString().slice(0, 13);
      if (hourlyMap.has(hourStr)) {
        const current = hourlyMap.get(hourStr)!;
        current.cost += Number(log.cost_usd) || 0;
        current.requests += 1;
        if (log.response_time_ms && log.response_time_ms > 0) {
          current.totalLatency += Number(log.response_time_ms);
          current.count += 1;
        }
      }
    });

    const hourlyTrend = Array.from(hourlyMap.entries())
      .map(([hour, data]) => ({
        hour,
        cost: Math.round(data.cost * 1000) / 1000,
        requests: data.requests,
        avgLatency: data.count > 0 ? Math.round(data.totalLatency / data.count) : 0,
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    // Top endpoints
    const endpointMap = new Map<string, { cost: number; count: number; totalLatency: number; latencyCount: number; apiName: string }>();
    allLogs.forEach(log => {
      const endpoint = log.endpoint || "unknown";
      const current = endpointMap.get(endpoint) || { cost: 0, count: 0, totalLatency: 0, latencyCount: 0, apiName: log.api_name || "unknown" };
      current.cost += Number(log.cost_usd) || 0;
      current.count += 1;
      if (log.response_time_ms && log.response_time_ms > 0) {
        current.totalLatency += Number(log.response_time_ms);
        current.latencyCount += 1;
      }
      endpointMap.set(endpoint, current);
    });

    const topEndpoints = Array.from(endpointMap.entries())
      .map(([endpoint, data]) => ({
        endpoint,
        apiName: data.apiName,
        cost: Math.round(data.cost * 1000) / 1000,
        count: data.count,
        avgLatency: data.latencyCount > 0 ? Math.round(data.totalLatency / data.latencyCount) : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    // Recent activity
    const recentActivity = recentLogs.map(log => ({
      id: log.id,
      timestamp: log.timestamp,
      apiName: log.api_name || "unknown",
      endpoint: log.endpoint || "unknown",
      status: log.response_status || 0,
      responseTimeMs: Number(log.response_time_ms) || 0,
      costUsd: Number(log.cost_usd) || 0,
      cacheHit: log.cache_hit || false,
      error: log.error_message || undefined,
    }));

    const analytics: EnhancedCostAnalytics = {
      summary: {
        totalCostUsd: Math.round(totalCostUsd * 100) / 100,
        todayCostUsd: Math.round(todayCostUsd * 100) / 100,
        last7DaysCostUsd: Math.round(last7DaysCostUsd * 100) / 100,
        last30DaysCostUsd: Math.round(last30DaysCostUsd * 100) / 100,
        totalRequests: allLogs.length,
        todayRequests: todayLogs.length,
        avgCostPerRequest: Math.round(avgCostPerRequest * 10000) / 10000,
        projectedMonthlyCost: Math.round(projectedMonthlyCost * 100) / 100,
      },
      performance: {
        avgResponseTimeMs: Math.round(avgResponseTimeMs),
        p50ResponseTimeMs: Math.round(calculatePercentile(responseTimes, 50)),
        p95ResponseTimeMs: Math.round(calculatePercentile(responseTimes, 95)),
        p99ResponseTimeMs: Math.round(calculatePercentile(responseTimes, 99)),
        errorRate: Math.round(errorRate * 10) / 10,
        totalErrors: errorLogs.length,
        successRate: Math.round((100 - errorRate) * 10) / 10,
      },
      cache: {
        hitRate: Math.round(hitRate * 10) / 10,
        totalHits: totalCacheHits, // From cache tables only (actual cache usage)
        totalMisses: cacheMissesFromLogs, // From API logs (actual API calls)
        estimatedSavingsUsd: Math.round(estimatedSavingsUsd * 100) / 100,
        byType: {
          geocode: { entries: geocodeCache.length, hits: geocodeHits },
          distance: { entries: distanceCache.length, hits: distanceHits },
          places: { entries: placesCache.length, hits: placesHits },
          activities: { entries: activitiesCache.length, hits: activitiesHits },
        },
      },
      circuitBreakers,
      byApi,
      byUser,
      dailyTrend,
      hourlyTrend,
      topEndpoints,
      recentActivity,
      generatedAt: now.toISOString(),
    };

    return apiSuccess(analytics);
  } catch (error) {
    console.error("[Admin Costs] Error:", error);
    return errors.internal("Failed to fetch cost analytics", "Admin Costs");
  }
}
