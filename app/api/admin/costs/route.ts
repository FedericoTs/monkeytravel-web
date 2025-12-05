import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

// API cost estimates per request (USD)
const API_COSTS: Record<string, number> = {
  "google_places": 0.017,      // Places Text Search ~$17/1000
  "google_geocoding": 0.005,   // Geocoding ~$5/1000
  "google_distance": 0.005,    // Distance Matrix ~$5/1000
  "gemini": 0.0005,            // Gemini Flash ~$0.50/1000 (estimated)
};

export interface CostAnalytics {
  // Summary metrics
  summary: {
    totalCostUsd: number;
    todayCostUsd: number;
    last7DaysCostUsd: number;
    last30DaysCostUsd: number;
    totalRequests: number;
    todayRequests: number;
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
    };
  };

  // Cost breakdown by API
  byApi: {
    apiName: string;
    totalCost: number;
    requestCount: number;
    cacheHits: number;
    cacheMisses: number;
  }[];

  // Daily trend (last 30 days)
  dailyTrend: {
    date: string;
    cost: number;
    requests: number;
    cacheHits: number;
  }[];

  // Top expensive endpoints
  topEndpoints: {
    endpoint: string;
    cost: number;
    count: number;
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

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const day7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all data in parallel
    const [
      allLogsResult,
      todayLogsResult,
      last7DaysLogsResult,
      last30DaysLogsResult,
      geocodeCacheResult,
      distanceCacheResult,
      placesCacheResult,
    ] = await Promise.all([
      // All API request logs
      supabase
        .from("api_request_logs")
        .select("api_name, endpoint, cost_usd, cache_hit, timestamp"),

      // Today's logs
      supabase
        .from("api_request_logs")
        .select("cost_usd")
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
    ]);

    const allLogs = allLogsResult.data || [];
    const todayLogs = todayLogsResult.data || [];
    const last7DaysLogs = last7DaysLogsResult.data || [];
    const last30DaysLogs = last30DaysLogsResult.data || [];
    const geocodeCache = geocodeCacheResult.data || [];
    const distanceCache = distanceCacheResult.data || [];
    const placesCache = placesCacheResult.data || [];

    // Calculate summary metrics
    const totalCostUsd = allLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const todayCostUsd = todayLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const last7DaysCostUsd = last7DaysLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);
    const last30DaysCostUsd = last30DaysLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0);

    // Calculate cache stats
    const geocodeHits = geocodeCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const distanceHits = distanceCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const placesHits = placesCache.reduce((sum, c) => sum + (c.hit_count || 0), 0);
    const totalCacheHits = geocodeHits + distanceHits + placesHits;

    // Calculate cache hit/miss from logs
    const cacheHitsFromLogs = allLogs.filter(l => l.cache_hit).length;
    const cacheMissesFromLogs = allLogs.filter(l => !l.cache_hit).length;
    const hitRate = allLogs.length > 0
      ? (cacheHitsFromLogs / allLogs.length) * 100
      : 0;

    // Estimate savings (cache hits * average API cost)
    const avgCost = 0.01; // $0.01 average per request
    const estimatedSavingsUsd = (totalCacheHits + cacheHitsFromLogs) * avgCost;

    // Group by API
    const byApiMap = new Map<string, { cost: number; count: number; hits: number; misses: number }>();
    allLogs.forEach(log => {
      const apiName = log.api_name || "unknown";
      const current = byApiMap.get(apiName) || { cost: 0, count: 0, hits: 0, misses: 0 };
      current.cost += Number(log.cost_usd) || 0;
      current.count += 1;
      if (log.cache_hit) {
        current.hits += 1;
      } else {
        current.misses += 1;
      }
      byApiMap.set(apiName, current);
    });

    const byApi = Array.from(byApiMap.entries())
      .map(([apiName, data]) => ({
        apiName,
        totalCost: Math.round(data.cost * 1000) / 1000,
        requestCount: data.count,
        cacheHits: data.hits,
        cacheMisses: data.misses,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    // Daily trend (last 30 days)
    const dailyMap = new Map<string, { cost: number; requests: number; cacheHits: number }>();

    // Initialize all days in the last 30 days
    for (let i = 0; i < 30; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split("T")[0];
      dailyMap.set(dateStr, { cost: 0, requests: 0, cacheHits: 0 });
    }

    // Fill in actual data
    allLogs.forEach(log => {
      if (!log.timestamp) return;
      const dateStr = new Date(log.timestamp).toISOString().split("T")[0];
      if (dailyMap.has(dateStr)) {
        const current = dailyMap.get(dateStr)!;
        current.cost += Number(log.cost_usd) || 0;
        current.requests += 1;
        if (log.cache_hit) current.cacheHits += 1;
      }
    });

    const dailyTrend = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        cost: Math.round(data.cost * 1000) / 1000,
        requests: data.requests,
        cacheHits: data.cacheHits,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top endpoints by cost
    const endpointMap = new Map<string, { cost: number; count: number }>();
    allLogs.forEach(log => {
      const endpoint = log.endpoint || "unknown";
      const current = endpointMap.get(endpoint) || { cost: 0, count: 0 };
      current.cost += Number(log.cost_usd) || 0;
      current.count += 1;
      endpointMap.set(endpoint, current);
    });

    const topEndpoints = Array.from(endpointMap.entries())
      .map(([endpoint, data]) => ({
        endpoint,
        cost: Math.round(data.cost * 1000) / 1000,
        count: data.count,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    const analytics: CostAnalytics = {
      summary: {
        totalCostUsd: Math.round(totalCostUsd * 100) / 100,
        todayCostUsd: Math.round(todayCostUsd * 100) / 100,
        last7DaysCostUsd: Math.round(last7DaysCostUsd * 100) / 100,
        last30DaysCostUsd: Math.round(last30DaysCostUsd * 100) / 100,
        totalRequests: allLogs.length,
        todayRequests: todayLogs.length,
      },
      cache: {
        hitRate: Math.round(hitRate * 10) / 10,
        totalHits: cacheHitsFromLogs,
        totalMisses: cacheMissesFromLogs,
        estimatedSavingsUsd: Math.round(estimatedSavingsUsd * 100) / 100,
        byType: {
          geocode: { entries: geocodeCache.length, hits: geocodeHits },
          distance: { entries: distanceCache.length, hits: distanceHits },
          places: { entries: placesCache.length, hits: placesHits },
        },
      },
      byApi,
      dailyTrend,
      topEndpoints,
    };

    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Admin costs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cost analytics" },
      { status: 500 }
    );
  }
}
