// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import type { EnhancedCostAnalytics } from "./route";

/**
 * The Costs tab's numbers cover what it says they cover. The real route runs over
 * rows answered as PostgREST answers them, at most 1,000 per request, which is how
 * this tab once read "30 days" off the last 1,000 calls.
 */

const s = vi.hoisted(() => ({
  admin: true,
  logs: [] as Array<Record<string, unknown>>,
  spend: [] as Array<Record<string, unknown>>,
  spendFails: false,
  placesCache: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
  log: [] as unknown[],
}));

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () => ({
    errorResponse: s.admin ? null : Response.json({ error: "Forbidden" }, { status: 403 }),
  }),
}));
vi.mock("@/lib/api-gateway", () => ({ circuitBreakerManager: { getAllStats: () => ({}) } }));

const passes = (row: Record<string, unknown>, q: FakeQuery) =>
  q.filters.every(([op, column, value]) => {
    const actual = row[column];
    if (op === "is") return value === null ? actual === null || actual === undefined : actual === value;
    if (op === "gte") return String(actual) >= String(value);
    if (op === "lte") return String(actual) <= String(value);
    return true;
  });

/** The rows of a read, in its order, stopping where PostgREST stops. */
function answered(rows: Array<Record<string, unknown>>, q: FakeQuery) {
  const newestFirst = q.orderBy?.[0] === "timestamp";
  const sorted = rows
    .filter((row) => passes(row, q))
    .sort((a, b) => {
      if (newestFirst && a.timestamp !== b.timestamp) return String(a.timestamp) > String(b.timestamp) ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  return sorted.slice(0, Math.min(q.limitTo ?? 1000, 1000));
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) => {
      if (q.table === "api_spend_by_unit") {
        return s.spendFails ? { data: null, error: { message: "spend failed" } } : { data: s.spend, error: null };
      }
      const rows =
        q.table === "api_request_logs"
          ? s.logs
          : q.table === "google_places_cache"
            ? s.placesCache
            : q.table === "users"
              ? s.users
              : [];
      return { data: answered(rows, q), error: null };
    });
    s.log = db.log;
    return db.client;
  },
}));

const { GET } = await import("./route");

const NOW = Date.now();
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
let serial = 0;
const call = (hours: number, extra: Record<string, unknown> = {}) => ({
  id: `log-${String(serial++).padStart(6, "0")}`,
  api_name: "gemini",
  endpoint: "/api/ai/generate/stream",
  cost_usd: 0.01,
  cache_hit: false,
  timestamp: hoursAgo(hours),
  response_status: 200,
  response_time_ms: 100,
  user_id: null,
  error_message: null,
  ...extra,
});

async function costs() {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as EnhancedCostAnalytics };
}

beforeEach(() => {
  serial = 0;
  s.admin = true;
  s.spendFails = false;
  s.logs = [];
  s.spend = [];
  s.placesCache = [];
  s.users = [];
  s.log = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Costs tab's 30 days", () => {
  beforeEach(() => {
    // Well past one request's worth, spread over the month. Some share a timestamp,
    // as a batch of logs does, across where a page ends.
    s.logs = [
      ...Array.from({ length: 1500 }, (_, i) => call(2 + (i - i % 40) / 10_000)),
      ...Array.from({ length: 1200 }, (_, i) => call(24 * 3 + (i - i % 40) / 10_000)),
      ...Array.from({ length: 900 }, (_, i) => call(24 * 20 + (i - i % 40) / 10_000)),
    ];
  });

  it("counts every call in the month, not the newest thousand", async () => {
    const { body } = await costs();
    expect(body.byApi).toHaveLength(1);
    expect(body.byApi[0].requestCount).toBe(3600);
    expect(body.summary.last30DaysCostUsd).toBe(36);
    expect(body.topEndpoints[0].count).toBe(3600);
    expect(body.dailyTrend.reduce((sum: number, day: { requests: number }) => sum + day.requests, 0)).toBe(3600);
  });

  it("gives today and the last week from the same calls", async () => {
    const { body } = await costs();
    expect(body.summary.last7DaysCostUsd).toBe(27);
    expect(body.summary.projectedMonthlyCost).toBeCloseTo((27 / 7) * 30, 1);
  });

  it("reads no further back than the month", async () => {
    s.logs.push(call(24 * 40, { id: "old" }));
    const { body } = await costs();
    expect(body.byApi[0].requestCount).toBe(3600);
  });

  it("leaves out test calls, as the all-time total does", async () => {
    s.logs.push(call(1, { "request_params->>probe": "true" }));
    const { body } = await costs();
    expect(body.byApi[0].requestCount).toBe(3600);
  });
});

describe("the all-time total", () => {
  it("comes from a sum over every call, not from rows", async () => {
    s.spend = [
      { api_name: "gemini", unit_usd: 0.0123, calls: 90_000, usd: 1107 },
      { api_name: "google_places", unit_usd: 0.017, calls: 750, usd: 12.75 },
    ];
    const { body } = await costs();
    expect(body.summary.totalCostUsd).toBe(1119.75);
    expect(body.summary.totalRequests).toBe(90_750);
    expect(body.summary.avgCostPerRequest).toBeCloseTo(1119.75 / 90_750, 4);
    const logReads = (s.log as FakeQuery[]).filter((q) => q.table === "api_request_logs");
    expect(logReads.every((q) => q.columns !== "cost_usd")).toBe(true);
  });

  it("asks over all of time, up to now", async () => {
    await costs();
    const ask = (s.log as FakeQuery[]).find((q) => q.table === "api_spend_by_unit")!.value as { p_from: string; p_to: string };
    expect(new Date(ask.p_from).getTime()).toBe(0);
    expect(new Date(ask.p_to).getTime()).toBeGreaterThan(NOW - 60_000);
  });
});

describe("the rest of the tab", () => {
  it("counts every entry and hit of a cache past one request's worth", async () => {
    s.placesCache = Array.from({ length: 2300 }, (_, i) => ({ id: `place-${String(i).padStart(5, "0")}`, hit_count: 2 }));
    const { body } = await costs();
    expect(body.cache.byType.places).toEqual({ entries: 2300, hits: 4600 });
  });

  it("names a spender from past the first page of users", async () => {
    s.users = Array.from({ length: 1200 }, (_, i) => ({ id: `user-${String(i).padStart(5, "0")}`, email: `u${i}@example.com` }));
    s.logs = [call(1, { user_id: "user-01150" })];
    const { body } = await costs();
    expect(body.byUser[0]).toMatchObject({ userId: "user-01150", email: "u1150@example.com" });
  });

  it("keeps the recent calls to the feed's fifty", async () => {
    s.logs = Array.from({ length: 80 }, () => call(1));
    const { body } = await costs();
    expect(body.recentActivity).toHaveLength(50);
  });

  it("is only for admins", async () => {
    s.admin = false;
    expect((await costs()).status).toBe(403);
    expect(s.log).toEqual([]);
  });
});
