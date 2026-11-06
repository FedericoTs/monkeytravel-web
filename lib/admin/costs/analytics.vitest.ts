import { describe, expect, it } from "vitest";
import { computeCostAnalytics } from "./analytics";
import type { CostRows, LogRow } from "./rows";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

let serial = 0;
const call = (extra: Partial<LogRow> = {}): LogRow => ({
  id: `log-${++serial}`,
  api_name: "gemini",
  endpoint: "/api/ai/concierge",
  cost_usd: 0.1,
  cache_hit: false,
  timestamp: hoursAgo(1),
  response_status: 200,
  response_time_ms: 100,
  user_id: null,
  error_message: null,
  ...extra,
});

const analytics = (rows: Partial<CostRows>, breakers = {}) =>
  computeCostAnalytics(
    {
      logs: [],
      spend: [],
      thisMonth: [],
      lastMonth: [],
      lastWeek: [],
      recentLogs: [],
      caches: { geocode: [], distance: [], places: [], activities: [] },
      users: [],
      credit: null,
      ...rows,
    },
    breakers,
    NOW
  );

describe("the Gemini credit", () => {
  it("is passed on as read", () => {
    const credit = { reading: { usd: 50, at: hoursAgo(2) }, spentUsd: 1, usd: 49, perDayUsd: 1, lasts: "about 49 days", low: false };
    expect(analytics({ credit }).credit).toBe(credit);
    expect(analytics({}).credit).toBeNull();
  });
});

describe("the summary", () => {
  it("adds up the all-time sums, the month, the week and today", () => {
    const { summary } = analytics({
      spend: [
        { calls: 1000, usd: 10 },
        { calls: 1000, usd: 30 },
      ],
      logs: [
        call({ cost_usd: 1, timestamp: hoursAgo(1) }),
        call({ cost_usd: 2, timestamp: hoursAgo(24 * 3) }),
        call({ cost_usd: 4, timestamp: hoursAgo(24 * 20) }),
      ],
    });
    expect(summary).toEqual({
      totalCostUsd: 40,
      totalRequests: 2000,
      avgCostPerRequest: 0.02,
      todayCostUsd: 1,
      todayRequests: 1,
      last7DaysCostUsd: 3,
      last30DaysCostUsd: 7,
      projectedMonthlyCost: 0,
      lastMonthCostUsd: 0,
    });
  });

  it("estimates the month after Google's free calls, not the last week at list price", () => {
    const photos = (calls: number) => ({ api_name: "google_places_photo", unit_usd: 0.007, calls, usd: calls * 0.007 });
    const gemini = (usd: number) => ({ api_name: "gemini", unit_usd: 0.02, calls: usd / 0.02, usd });
    const { summary } = analytics({
      // 25.5 days are left at noon on the 5th: 2,550 more photos at 100 a day, 5.10 more of Gemini.
      thisMonth: [photos(1000), gemini(2)],
      lastWeek: [photos(700), gemini(1.4)],
      lastMonth: [photos(13_762), gemini(38.83)],
      logs: [call({ cost_usd: 64, timestamp: hoursAgo(24) })],
    });
    expect(summary.last7DaysCostUsd).toBe(64);
    expect(summary.projectedMonthlyCost).toBe(24.95);
    expect(summary.lastMonthCostUsd).toBe(128.16);
  });

  it("counts the days left to the end of a December too", () => {
    const gemini = (usd: number) => ({ api_name: "gemini", unit_usd: 0.02, calls: usd / 0.02, usd });
    const summary = computeCostAnalytics(
      {
        logs: [],
        spend: [],
        thisMonth: [],
        lastMonth: [],
        lastWeek: [gemini(7)],
        recentLogs: [],
        caches: { geocode: [], distance: [], places: [], activities: [] },
        users: [],
      },
      {},
      new Date("2026-12-31T00:00:00.000Z")
    ).summary;
    expect(summary.projectedMonthlyCost).toBe(1);
  });

  it("reads sums the database answers as text, and costs that are missing", () => {
    const { summary } = analytics({
      spend: [{ calls: "5" as never, usd: "1.5" as never }],
      logs: [call({ cost_usd: "0.5" as never }), call({ cost_usd: null })],
    });
    expect(summary).toMatchObject({ totalCostUsd: 1.5, totalRequests: 5, last30DaysCostUsd: 0.5 });
  });

  it("has nothing to divide with no calls", () => {
    expect(analytics({}).summary.avgCostPerRequest).toBe(0);
  });
});

describe("performance", () => {
  it("takes percentiles and the average from the calls that have a time", () => {
    const logs = [10, 20, 30, 40, 0, null].map((ms) => call({ response_time_ms: ms }));
    expect(analytics({ logs }).performance).toMatchObject({
      avgResponseTimeMs: 25,
      p50ResponseTimeMs: 20,
      p95ResponseTimeMs: 40,
      p99ResponseTimeMs: 40,
    });
  });

  it("counts a refused call or one with an error message as failed", () => {
    const { performance } = analytics({
      logs: [call(), call(), call({ response_status: 402 }), call({ error_message: "boom" })],
    });
    expect(performance).toMatchObject({ errorRate: 50, totalErrors: 2, successRate: 50 });
  });

  it("is all zeros, and fully successful, with no calls", () => {
    expect(analytics({}).performance).toMatchObject({ avgResponseTimeMs: 0, p99ResponseTimeMs: 0, errorRate: 0, successRate: 100 });
  });
});

describe("the cache", () => {
  it("counts hits from the cache tables and misses from the calls", () => {
    const row = (id: string, hits: number | null) => ({ id, hit_count: hits });
    const { cache } = analytics({
      logs: [call({ cache_hit: true }), call({ cache_hit: false }), call({ cache_hit: null }), call({ cache_hit: false })],
      caches: { geocode: [row("a", 1)], distance: [row("b", 2), row("c", null)], places: [row("d", 3)], activities: [row("e", 4)] },
    });
    expect(cache).toEqual({
      hitRate: 25,
      totalHits: 10,
      totalMisses: 3,
      estimatedSavingsUsd: 0.1,
      byType: {
        geocode: { entries: 1, hits: 1 },
        distance: { entries: 2, hits: 2 },
        places: { entries: 1, hits: 3 },
        activities: { entries: 1, hits: 4 },
      },
    });
  });
});

describe("the circuit breakers", () => {
  it("shows the live ones, and every other known API as closed", () => {
    const { circuitBreakers } = analytics(
      {},
      { google_places_search: { state: "OPEN", failureCount: 5, successCount: 1, lastFailureTime: 9 }, made_up: { state: "HALF_OPEN", failureCount: 1, successCount: 0, lastFailureTime: 3 } }
    );
    expect(circuitBreakers[0]).toEqual({ apiName: "google_places_search", state: "OPEN", failureCount: 5, successCount: 1, lastFailureTime: 9 });
    expect(circuitBreakers[1].apiName).toBe("made_up");
    expect(circuitBreakers.length).toBeGreaterThan(2);
    expect(circuitBreakers.filter((b) => b.apiName === "google_places_search")).toHaveLength(1);
    expect(circuitBreakers.slice(2).every((b) => b.state === "CLOSED" && b.failureCount === 0)).toBe(true);
  });
});

describe("the breakdowns", () => {
  it("groups by API, most expensive first, with a known name or the raw one", () => {
    const { byApi } = analytics({
      logs: [
        call({ api_name: "gemini", cost_usd: 1, cache_hit: true, response_time_ms: 100 }),
        call({ api_name: "gemini", cost_usd: 1, response_status: 500, response_time_ms: 300 }),
        call({ api_name: "google_places_photo", cost_usd: 5, response_time_ms: 0 }),
        call({ api_name: "made_up", cost_usd: 0.5 }),
        call({ api_name: null, cost_usd: 0.1 }),
      ],
    });
    expect(byApi.map((api) => api.displayName)).toEqual(["Place Photos", "Gemini AI", "made_up", "unknown"]);
    expect(byApi[1]).toMatchObject({ totalCost: 2, requestCount: 2, cacheHits: 1, cacheMisses: 1, errorCount: 1, errorRate: 50, avgResponseTimeMs: 200, color: "#FF6D00" });
    expect(byApi[0].avgResponseTimeMs).toBe(0);
    expect(byApi[2].color).toBe("#78909C");
  });

  it("names the top ten spenders, skipping calls with no user", () => {
    const logs = Array.from({ length: 12 }, (_, i) => call({ user_id: `user-${i}`, cost_usd: i + 1 }));
    const { byUser } = analytics({ logs: [...logs, call({ user_id: null, cost_usd: 99 })], users: [{ id: "user-11", email: "top@example.com" }, { id: "user-10", email: null }] });
    expect(byUser).toHaveLength(10);
    expect(byUser[0]).toEqual({ userId: "user-11", email: "top@example.com", totalCost: 12, requestCount: 1 });
    expect(byUser[1].email).toBeUndefined();
  });

  it("ranks the ten costliest endpoints, with their first API and average time", () => {
    const logs = [
      ...Array.from({ length: 12 }, (_, i) => call({ endpoint: `/e${i}`, cost_usd: i + 1 })),
      call({ endpoint: "/e11", api_name: "other", cost_usd: 1, response_time_ms: 300 }),
      call({ endpoint: null, cost_usd: 0.1 }),
    ];
    const { topEndpoints } = analytics({ logs });
    expect(topEndpoints).toHaveLength(10);
    expect(topEndpoints[0]).toEqual({ endpoint: "/e11", apiName: "gemini", cost: 13, count: 2, avgLatency: 200 });
  });
});

describe("the trends", () => {
  it("has a row for each of the last 30 days, oldest first, with what happened", () => {
    const { dailyTrend } = analytics({
      logs: [
        call({ cost_usd: 1, cache_hit: true, response_status: 500 }),
        call({ cost_usd: 2 }),
        call({ timestamp: hoursAgo(24 * 40) }),
        call({ timestamp: null }),
      ],
    });
    expect(dailyTrend).toHaveLength(30);
    expect(dailyTrend[0].date < dailyTrend[29].date).toBe(true);
    expect(dailyTrend[29]).toEqual({ date: "2026-11-05", cost: 3, requests: 2, cacheHits: 1, errors: 1 });
    expect(dailyTrend.slice(0, 29).every((day) => day.requests === 0)).toBe(true);
  });

  it("has a row for each of the last 24 hours, with the average time of the calls that have one", () => {
    const { hourlyTrend } = analytics({
      logs: [
        call({ timestamp: hoursAgo(0), cost_usd: 1, response_time_ms: 100 }),
        call({ timestamp: hoursAgo(0), cost_usd: 1, response_time_ms: 300 }),
        call({ timestamp: hoursAgo(0), cost_usd: 1, response_time_ms: 0 }),
        call({ timestamp: hoursAgo(30) }),
      ],
    });
    expect(hourlyTrend).toHaveLength(24);
    expect(hourlyTrend[23]).toEqual({ hour: "2026-11-05T12", cost: 3, requests: 3, avgLatency: 200 });
    expect(hourlyTrend.slice(0, 23).every((hour) => hour.requests === 0)).toBe(true);
  });
});

describe("the feed", () => {
  it("shows the newest calls, filling in what's missing", () => {
    const { recentActivity, generatedAt } = analytics({
      recentLogs: [call({ id: "a", api_name: null, endpoint: null, response_status: null, response_time_ms: null, cost_usd: null, cache_hit: null, error_message: "boom", timestamp: "2026-11-05T11:00:00.000Z" })],
    });
    expect(recentActivity).toEqual([
      { id: "a", timestamp: "2026-11-05T11:00:00.000Z", apiName: "unknown", endpoint: "unknown", status: 0, responseTimeMs: 0, costUsd: 0, cacheHit: false, error: "boom" },
    ]);
    expect(generatedAt).toBe(NOW.toISOString());
  });
});
