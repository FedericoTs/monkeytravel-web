// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import type { AdminStats } from "@/lib/admin/stats/types";

/**
 * The Analytics tab counts whole tables. The real route runs over rows answered as
 * PostgREST answers them, at most 1,000 per request, which is how this tab once
 * priced Gemini off a fifth of its calls and is how it would lose its newest signups.
 */

const s = vi.hoisted(() => ({
  admin: true,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  log: [] as unknown[],
}));

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () => ({
    errorResponse: s.admin ? null : Response.json({ error: "Forbidden" }, { status: 403 }),
  }),
}));
vi.mock("@/lib/admin/activation-funnel", () => ({ fetchActivationFunnel: async () => null }));

const answered = (rows: Array<Record<string, unknown>>, q: FakeQuery) =>
  rows
    .filter((row) =>
      q.filters.every(([op, column, value]) => {
        if (op === "eq") return row[column] === value;
        if (op === "gte") return String(row[column]) >= String(value);
        return true;
      })
    )
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
    .slice(0, Math.min(q.limitTo ?? 1000, 1000));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) => {
      if (q.op === "rpc") {
        if (q.table === "get_user_metrics") return { data: { total: (s.tables.users ?? []).length }, error: null };
        if (q.table === "get_trip_metrics") return { data: { total: (s.tables.trips ?? []).length }, error: null };
        if (q.table === "get_ai_usage_metrics") return { data: { total: 0 }, error: null };
        if (q.table === "get_subscriber_metrics") return { data: { total: 0 }, error: null };
        return { data: [], error: null };
      }
      const rows = s.tables[q.table] ?? [];
      return { data: answered(rows, q), error: null, count: rows.length };
    });
    s.log = db.log;
    return db.client;
  },
}));

const { GET } = await import("./route");

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const id = (prefix: string, i: number) => `${prefix}-${String(i).padStart(6, "0")}`;

async function stats() {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as AdminStats };
}

beforeEach(() => {
  s.admin = true;
  s.tables = {};
  s.log = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the cost of the model", () => {
  const gemini = (i: number, extra: Record<string, unknown>) => ({
    id: id("log", i),
    api_name: "gemini",
    cost_usd: 0.01,
    endpoint: "/api/ai/concierge",
    response_status: 200,
    cache_hit: false,
    ...extra,
  });

  it("adds up every call, past what one request answers", async () => {
    s.tables.api_request_logs = Array.from({ length: 2500 }, (_, i) => gemini(i, {}));
    const { body } = await stats();
    expect(body.ai.generationCosts.totalUsd).toBeCloseTo(25, 5);
    expect(body.ai.totalCostUsd).toBeCloseTo(25, 5);
  });

  it("leaves out other APIs", async () => {
    s.tables.api_request_logs = [gemini(1, {}), gemini(2, { api_name: "google_places" })];
    expect((await stats()).body.ai.generationCosts.totalUsd).toBeCloseTo(0.01, 5);
  });

  it("counts a plan from either route, once the model has made it", async () => {
    s.tables.api_request_logs = [
      gemini(1, { endpoint: "/api/ai/generate/stream" }),
      gemini(2, { endpoint: "/api/ai/generate" }),
      gemini(3, { endpoint: "/api/ai/generate/stream", response_status: 402 }),
      gemini(4, { endpoint: "/api/ai/generate/stream", cache_hit: true }),
      gemini(5, { endpoint: "/api/ai/regenerate-activity" }),
      gemini(6, { endpoint: "/api/ai/regenerate-activity", response_status: 500 }),
    ];
    const { generationCosts } = (await stats()).body.ai;
    expect(generationCosts.tripGenerations).toBe(2);
    expect(generationCosts.activityRegenerations).toBe(1);
  });
});

describe("whole tables, past what one request answers", () => {
  const trips = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({
      id: id("trip", i),
      user_id: id("user", i % 1100),
      status: "planning",
      title: "Lisbon Trip",
      trip_meta: { destination: "Lisbon" },
      created_at: daysAgo(40),
      ...extra(i),
    }));
  const users = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({ id: id("user", i), created_at: daysAgo(100), ...extra(i) }));

  it("counts trips by status and by place from all of them", async () => {
    s.tables.trips = trips(1500, (i) => (i >= 1400 ? { status: "completed", trip_meta: { destination: "Rome" } } : {}));
    const { body } = await stats();
    expect(body.trips.byStatus).toEqual({ planning: 1400, completed: 100 });
    expect(body.topDestinations).toEqual([
      { destination: "Lisbon", count: 1400 },
      { destination: "Rome", count: 100 },
    ]);
  });

  it("counts the people with a trip from all of them", async () => {
    s.tables.users = users(1200);
    s.tables.trips = trips(1500);
    const { body } = await stats();
    expect(body.users.withTrips).toBe(1100);
    expect(body.users.withoutTrips).toBe(100);
    expect(body.activation.multiTripUsers).toBe(400);
  });

  it("finds the people at risk among all of them", async () => {
    s.tables.users = users(1200);
    s.tables.trips = trips(1100);
    expect((await stats()).body.activation.atRiskUsers).toBe(100);
  });

  it("adds up the AI usage from all of it", async () => {
    s.tables.ai_usage = Array.from({ length: 1300 }, (_, i) => ({
      id: id("usage", i),
      action: i < 1200 ? "assistant" : "other",
      model_id: "gemini-2.5-flash",
      input_tokens: 10,
      output_tokens: 5,
      cost_cents: 1,
      created_at: daysAgo(1),
    }));
    const { ai } = (await stats()).body;
    expect(ai.byAction).toEqual({ assistant: 1200, other: 100 });
    expect(ai.byModel).toEqual({ "gemini-2.5-flash": 1300 });
    expect(ai.totalTokens).toEqual({ input: 13_000, output: 6500 });
    expect(ai.totalCostCents).toBe(1300);
  });

  it("keeps the newest signups in the trend and the cohorts", async () => {
    s.tables.users = users(1200, (i) => (i >= 1190 ? { created_at: daysAgo(0.01) } : {}));
    const { body } = await stats();
    const latest = body.userTrend.daily.at(-1);
    expect(latest?.cumulative).toBe(1200);
    expect(body.churn.cohortRetention.reduce((sum, cohort) => sum + cohort.cohortSize, 0)).toBe(1200);
  });

  it("sees activity past the first page, for who was active", async () => {
    s.tables.users = users(3);
    s.tables.trips = trips(1200, (i) => (i === 1150 ? { user_id: "late", created_at: daysAgo(1) } : {}));
    expect((await stats()).body.users.activeLast30Days).toBe(1);
  });

  it("is only for admins", async () => {
    s.admin = false;
    expect((await stats()).status).toBe(403);
    expect(s.log).toEqual([]);
  });
});
