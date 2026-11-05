import { API_COSTS } from "@/lib/api-gateway/config";
import type { CostRows, LogRow } from "./rows";
import type { EnhancedCostAnalytics } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a cache hit saves, as an estimate: there's no per-API figure for it. */
const AVG_API_COST_USD = 0.01;

// API display names and colors for the dashboard
const API_DISPLAY_CONFIG: Record<string, { name: string; color: string }> = {
  google_places_search: { name: "Places Search", color: "#4285F4" },
  google_places_autocomplete: { name: "Autocomplete", color: "#34A853" },
  google_places_details: { name: "Place Details", color: "#FBBC05" },
  google_places_photo: { name: "Place Photos", color: "#0F9D58" },
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

const costOfLog = (log: LogRow) => Number(log.cost_usd) || 0;
const costOf = (logs: LogRow[]) => logs.reduce((sum, log) => sum + costOfLog(log), 0);
const failed = (log: LogRow) => (log.response_status || 0) >= 400 || !!log.error_message;
const hasLatency = (log: LogRow) => !!log.response_time_ms && log.response_time_ms > 0;
const cents = (usd: number) => Math.round(usd * 100) / 100;
const mills = (usd: number) => Math.round(usd * 1000) / 1000;

function summaryOf({ logs, spend }: CostRows, now: Date): EnhancedCostAnalytics["summary"] {
  const since = (from: Date) => logs.filter((log) => log.timestamp && new Date(log.timestamp).getTime() >= from.getTime());
  const todayLogs = since(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const last7DaysCost = costOf(since(new Date(now.getTime() - 7 * DAY_MS)));

  // All-time totals come from the sum in the database; the rest from the 30 days of calls.
  const totalCost = spend.reduce((sum, row) => sum + (Number(row.usd) || 0), 0);
  const totalRequests = spend.reduce((sum, row) => sum + (Number(row.calls) || 0), 0);
  return {
    totalCostUsd: cents(totalCost),
    todayCostUsd: cents(costOf(todayLogs)),
    last7DaysCostUsd: cents(last7DaysCost),
    last30DaysCostUsd: cents(costOf(logs)),
    totalRequests,
    todayRequests: todayLogs.length,
    avgCostPerRequest: Math.round((totalRequests > 0 ? totalCost / totalRequests : 0) * 10000) / 10000,
    // Projected from the last 7 days.
    projectedMonthlyCost: cents((last7DaysCost / 7) * 30),
  };
}

function performanceOf({ logs }: CostRows): EnhancedCostAnalytics["performance"] {
  const responseTimes = logs.map((log) => Number(log.response_time_ms)).filter((ms) => ms > 0);
  const average = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;
  const errors = logs.filter(failed).length;
  const errorRate = logs.length > 0 ? (errors / logs.length) * 100 : 0;
  return {
    avgResponseTimeMs: Math.round(average),
    p50ResponseTimeMs: Math.round(calculatePercentile(responseTimes, 50)),
    p95ResponseTimeMs: Math.round(calculatePercentile(responseTimes, 95)),
    p99ResponseTimeMs: Math.round(calculatePercentile(responseTimes, 99)),
    errorRate: Math.round(errorRate * 10) / 10,
    totalErrors: errors,
    successRate: Math.round((100 - errorRate) * 10) / 10,
  };
}

function cacheOf({ logs, caches }: CostRows): EnhancedCostAnalytics["cache"] {
  const hitsIn = (rows: Array<{ hit_count: number | null }>) => rows.reduce((sum, c) => sum + (c.hit_count || 0), 0);
  const geocodeHits = hitsIn(caches.geocode);
  const distanceHits = hitsIn(caches.distance);
  const placesHits = hitsIn(caches.places);
  const activitiesHits = hitsIn(caches.activities);
  // Savings use the cache tables' hits only. A log's cache_hit is already in its cost_usd.
  const totalHits = geocodeHits + distanceHits + placesHits + activitiesHits;
  const hitRate = logs.length > 0 ? (logs.filter((log) => log.cache_hit).length / logs.length) * 100 : 0;
  return {
    hitRate: Math.round(hitRate * 10) / 10,
    totalHits,
    totalMisses: logs.filter((log) => !log.cache_hit).length,
    estimatedSavingsUsd: cents(totalHits * AVG_API_COST_USD),
    byType: {
      geocode: { entries: caches.geocode.length, hits: geocodeHits },
      distance: { entries: caches.distance.length, hits: distanceHits },
      places: { entries: caches.places.length, hits: placesHits },
      activities: { entries: caches.activities.length, hits: activitiesHits },
    },
  };
}

/** The live breakers, then every known API that hasn't used one yet, as closed. */
function circuitBreakersOf(stats: Record<string, CircuitStats>): EnhancedCostAnalytics["circuitBreakers"] {
  const breakers: EnhancedCostAnalytics["circuitBreakers"] = Object.entries(stats).map(([apiName, stat]) => ({
    apiName,
    state: stat.state,
    failureCount: stat.failureCount,
    successCount: stat.successCount,
    lastFailureTime: stat.lastFailureTime,
  }));
  const tracked = new Set(breakers.map((breaker) => breaker.apiName));
  for (const apiName of Object.keys(API_COSTS)) {
    if (!tracked.has(apiName)) {
      breakers.push({ apiName, state: "CLOSED", failureCount: 0, successCount: 0, lastFailureTime: 0 });
    }
  }
  return breakers;
}

function byApiOf({ logs }: CostRows): EnhancedCostAnalytics["byApi"] {
  const totals = new Map<string, { cost: number; count: number; hits: number; misses: number; errors: number; responseTimes: number[] }>();
  logs.forEach((log) => {
    const apiName = log.api_name || "unknown";
    const current = totals.get(apiName) || { cost: 0, count: 0, hits: 0, misses: 0, errors: 0, responseTimes: [] };
    current.cost += costOfLog(log);
    current.count += 1;
    if (log.cache_hit) current.hits += 1;
    else current.misses += 1;
    if (failed(log)) current.errors += 1;
    if (hasLatency(log)) current.responseTimes.push(Number(log.response_time_ms));
    totals.set(apiName, current);
  });

  return Array.from(totals.entries())
    .map(([apiName, data]) => {
      const display = getApiDisplay(apiName);
      const avgTime = data.responseTimes.length > 0 ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length : 0;
      return {
        apiName,
        displayName: display.name,
        totalCost: mills(data.cost),
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
}

function byUserOf({ logs, users }: CostRows): EnhancedCostAnalytics["byUser"] {
  const emails = new Map(users.map((user) => [user.id, user.email ?? undefined]));
  const totals = new Map<string, { cost: number; count: number }>();
  logs.forEach((log) => {
    if (!log.user_id) return;
    const current = totals.get(log.user_id) || { cost: 0, count: 0 };
    current.cost += costOfLog(log);
    current.count += 1;
    totals.set(log.user_id, current);
  });

  return Array.from(totals.entries())
    .map(([userId, data]) => ({
      userId,
      email: emails.get(userId),
      totalCost: mills(data.cost),
      requestCount: data.count,
    }))
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10);
}

function dailyTrendOf({ logs }: CostRows, now: Date): EnhancedCostAnalytics["dailyTrend"] {
  const days = new Map<string, { cost: number; requests: number; cacheHits: number; errors: number }>();
  for (let i = 0; i < 30; i++) {
    days.set(new Date(now.getTime() - i * DAY_MS).toISOString().split("T")[0], { cost: 0, requests: 0, cacheHits: 0, errors: 0 });
  }
  logs.forEach((log) => {
    if (!log.timestamp) return;
    const day = days.get(new Date(log.timestamp).toISOString().split("T")[0]);
    if (!day) return;
    day.cost += costOfLog(log);
    day.requests += 1;
    if (log.cache_hit) day.cacheHits += 1;
    if (failed(log)) day.errors += 1;
  });

  return Array.from(days.entries())
    .map(([date, data]) => ({ date, cost: mills(data.cost), requests: data.requests, cacheHits: data.cacheHits, errors: data.errors }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function hourlyTrendOf({ logs }: CostRows, now: Date): EnhancedCostAnalytics["hourlyTrend"] {
  const hours = new Map<string, { cost: number; requests: number; totalLatency: number; count: number }>();
  for (let i = 0; i < 24; i++) {
    hours.set(new Date(now.getTime() - i * 60 * 60 * 1000).toISOString().slice(0, 13), { cost: 0, requests: 0, totalLatency: 0, count: 0 });
  }
  logs.forEach((log) => {
    if (!log.timestamp) return;
    const logTime = new Date(log.timestamp);
    if (logTime.getTime() < now.getTime() - DAY_MS) return;
    const hour = hours.get(logTime.toISOString().slice(0, 13));
    if (!hour) return;
    hour.cost += costOfLog(log);
    hour.requests += 1;
    if (hasLatency(log)) {
      hour.totalLatency += Number(log.response_time_ms);
      hour.count += 1;
    }
  });

  return Array.from(hours.entries())
    .map(([hour, data]) => ({
      hour,
      cost: mills(data.cost),
      requests: data.requests,
      avgLatency: data.count > 0 ? Math.round(data.totalLatency / data.count) : 0,
    }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
}

function topEndpointsOf({ logs }: CostRows): EnhancedCostAnalytics["topEndpoints"] {
  const totals = new Map<string, { cost: number; count: number; totalLatency: number; latencyCount: number; apiName: string }>();
  logs.forEach((log) => {
    const endpoint = log.endpoint || "unknown";
    const current = totals.get(endpoint) || { cost: 0, count: 0, totalLatency: 0, latencyCount: 0, apiName: log.api_name || "unknown" };
    current.cost += costOfLog(log);
    current.count += 1;
    if (hasLatency(log)) {
      current.totalLatency += Number(log.response_time_ms);
      current.latencyCount += 1;
    }
    totals.set(endpoint, current);
  });

  return Array.from(totals.entries())
    .map(([endpoint, data]) => ({
      endpoint,
      apiName: data.apiName,
      cost: mills(data.cost),
      count: data.count,
      avgLatency: data.latencyCount > 0 ? Math.round(data.totalLatency / data.latencyCount) : 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
}

function recentActivityOf({ recentLogs }: CostRows): EnhancedCostAnalytics["recentActivity"] {
  return recentLogs.map((log) => ({
    id: log.id,
    timestamp: log.timestamp as string,
    apiName: log.api_name || "unknown",
    endpoint: log.endpoint || "unknown",
    status: log.response_status || 0,
    responseTimeMs: Number(log.response_time_ms) || 0,
    costUsd: costOfLog(log),
    cacheHit: log.cache_hit || false,
    error: log.error_message || undefined,
  }));
}

export interface CircuitStats {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
}

/** The Costs tab's numbers, from the rows it reads and the live circuit breakers. */
export function computeCostAnalytics(rows: CostRows, breakers: Record<string, CircuitStats>, now: Date): EnhancedCostAnalytics {
  return {
    summary: summaryOf(rows, now),
    performance: performanceOf(rows),
    cache: cacheOf(rows),
    circuitBreakers: circuitBreakersOf(breakers),
    byApi: byApiOf(rows),
    byUser: byUserOf(rows),
    dailyTrend: dailyTrendOf(rows, now),
    hourlyTrend: hourlyTrendOf(rows, now),
    topEndpoints: topEndpointsOf(rows),
    recentActivity: recentActivityOf(rows),
    generatedAt: now.toISOString(),
  };
}
