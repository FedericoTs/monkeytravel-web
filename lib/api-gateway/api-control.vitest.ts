import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * logApiCall's cost: a measured cost is logged as is, even 0. A plain 0 still
 * means "use api_config's flat cost_per_request", which books $0.003 for a
 * Gemini call that never ran.
 */

const inserts: Record<string, unknown>[] = [];
const configReads: string[] = [];
/** What the next api_config read answers, over the defaults; null: no such row. */
let configRow: Record<string, unknown> | null = {};
let configThrows = false;
const counted: Array<{ namespace: string; limit: number; windowMs: number; key: string }> = [];
let withinLimit = true;
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (namespace: string, limit: number, windowMs: number) => ({
    checkKey: async (key: string) => {
      counted.push({ namespace, limit, windowMs, key });
      return { allowed: withinLimit, remaining: 0 };
    },
  }),
}));
/** Scripted results for the next insert calls; an Error is thrown. Default: stored. */
const insertResults: Array<{ error: unknown; status: number } | Error> = [];
let insertCalls = 0;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        insertCalls++;
        const next = insertResults.shift() ?? { error: null, status: 201 };
        if (next instanceof Error) throw next;
        if (!next.error) inserts.push(row);
        return next;
      },
      select: (columns: string) => ({
        eq: (_col: string, apiName: string) => ({
          single: async () => {
            configReads.push(apiName);
            if (configThrows) throw new Error("read failed");
            if (!configRow) return { data: null, error: { message: "no rows" } };
            const row: Record<string, unknown> = {
              api_name: apiName,
              display_name: apiName,
              enabled: true,
              block_mode: "none",
              category: "ai",
              cost_per_request: "0.003",
              daily_limit: null,
              ...configRow,
            };
            // Only what was asked for, as PostgREST answers.
            return { data: Object.fromEntries(columns.split(", ").map((c) => [c, row[c]])), error: null };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { blockedCall, checkApiAccess, logApiCall, logApiCalls } from "./api-control";

const base = { apiName: "gemini", endpoint: "/api/ai/generate", status: 500, responseTimeMs: 10, cacheHit: false };

beforeEach(() => {
  inserts.length = 0;
  configReads.length = 0;
  insertResults.length = 0;
  insertCalls = 0;
  configRow = {};
  configThrows = false;
  counted.length = 0;
  withinLimit = true;
  vi.restoreAllMocks();
});

describe("checkApiAccess and the daily limit", () => {
  const TODAY = new Date().toISOString().slice(0, 10);

  it("counts nothing for an API with no limit", async () => {
    expect((await checkApiAccess("gemini")).allowed).toBe(true);
    expect(counted).toEqual([]);
  });

  it("counts the call under today's date, for a whole day, with the limit set for the API", async () => {
    configRow = { daily_limit: 800 };
    const access = await checkApiAccess("google_places_photo");
    expect(access).toMatchObject({ allowed: true, shouldPassKey: true });
    expect(counted).toEqual([{ namespace: "daily-google_places_photo", limit: 800, windowMs: 86_400_000, key: TODAY }]);
  });

  it("refuses past the limit, in plain words", async () => {
    configRow = { daily_limit: 800, display_name: "Place Photos" };
    withinLimit = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const access = await checkApiAccess("google_places_photo");
    expect(access).toMatchObject({ allowed: false, blockMode: "daily_limit", shouldPassKey: false });
    expect(access.message).toContain("today");
    expect(console.error).toHaveBeenCalled();
  });

  it("doesn't count a call a switched-off API refuses anyway", async () => {
    configRow = { daily_limit: 800, enabled: false, block_mode: "block_calls" };
    expect((await checkApiAccess("gemini")).allowed).toBe(false);
    expect(counted).toEqual([]);
  });

  it("treats a limit of 0 as stopping everything", async () => {
    configRow = { daily_limit: 0 };
    withinLimit = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkApiAccess("gemini")).allowed).toBe(false);
    expect(counted).toHaveLength(1);
  });

  it("shares one read between calls made at the same moment", async () => {
    await Promise.all([checkApiAccess("gemini"), checkApiAccess("gemini"), checkApiAccess("google_places_search")]);
    expect(configReads).toEqual(["gemini", "google_places_search"]);
  });

  it("reads again for the next call, so a switch takes effect at once", async () => {
    await checkApiAccess("gemini");
    configRow = { enabled: false };
    expect((await checkApiAccess("gemini")).allowed).toBe(false);
    expect(configReads).toEqual(["gemini", "gemini"]);
  });

  it("reads again after a read that failed", async () => {
    configThrows = true;
    await checkApiAccess("gemini");
    configThrows = false;
    configRow = { enabled: false };
    expect((await checkApiAccess("gemini")).allowed).toBe(false);
  });

  it("lets the call through when the setting can't be read: a limit is never an outage", async () => {
    configRow = { daily_limit: 800 };
    configThrows = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkApiAccess("gemini")).allowed).toBe(true);
    configThrows = false;
    configRow = null;
    expect((await checkApiAccess("gemini")).allowed).toBe(true);
    expect(counted).toEqual([]);
  });
});

describe("logApiCall cost", () => {
  it("logs a measured $0 as $0 and skips the config lookup", async () => {
    await logApiCall({ ...base, costUsd: 0, exactCost: true });
    expect(inserts[0].cost_usd).toBe(0);
    expect(configReads).toEqual([]);
  });

  it("logs a measured cost as is", async () => {
    await logApiCall({ ...base, status: 200, costUsd: 0.0174, exactCost: true });
    expect(inserts[0].cost_usd).toBe(0.0174);
  });

  it("still falls back to api_config for a plain 0", async () => {
    await logApiCall({ ...base, costUsd: 0 });
    expect(configReads).toEqual(["gemini"]);
    expect(inserts[0].cost_usd).toBe(0.003);
  });

  it("books a cache hit at $0 whatever the cost says", async () => {
    await logApiCall({ ...base, status: 200, cacheHit: true, costUsd: 0.0174, exactCost: true });
    expect(inserts[0].cost_usd).toBe(0);
  });

  it("books a cache hit at $0 without reading api_config", async () => {
    await logApiCall({ ...base, status: 200, cacheHit: true, costUsd: 0 });
    expect(inserts[0].cost_usd).toBe(0);
    expect(configReads).toEqual([]);
  });
});

describe("logApiCalls", () => {
  const hit = {
    apiName: "google_places_search",
    endpoint: "places:searchText (activity, cache hit)",
    status: 200,
    responseTimeMs: 0,
    cacheHit: true,
    costUsd: 0,
  };

  it("writes every row in one insert", async () => {
    await logApiCalls([hit, hit, hit]);
    expect(insertCalls).toBe(1);
    expect(inserts[0]).toHaveLength(3);
  });

  it("writes the rows logApiCall writes", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T12:00:00.000Z") });
    try {
      const calls = [
        hit,
        { ...base, costUsd: 0 },
        { ...base, status: 200, costUsd: 0.032, userId: "user-1", error: "partial", metadata: { place: "ChIJ1" } },
      ];
      for (const call of calls) await logApiCall(call);
      const oneByOne = inserts.splice(0);
      await logApiCalls(calls);
      expect(inserts).toEqual([oneByOne]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads api_config once per API", async () => {
    await logApiCalls([
      { ...base, costUsd: 0 },
      { ...base, costUsd: 0 },
      { ...base, apiName: "open_meteo", costUsd: 0 },
      hit,
    ]);
    expect([...configReads].sort()).toEqual(["gemini", "open_meteo"]);
    expect((inserts[0] as unknown as Array<{ cost_usd: number }>).map((row) => row.cost_usd)).toEqual([0.003, 0.003, 0.003, 0]);
  });

  it("writes nothing for no calls", async () => {
    await logApiCalls([]);
    expect(insertCalls).toBe(0);
  });

  it("retries the batch once on a dropped connection", async () => {
    insertResults.push({ error: { message: "TypeError: fetch failed" }, status: 0 });
    await logApiCalls([hit, hit]);
    expect(insertCalls).toBe(2);
    expect(inserts).toHaveLength(1);
  });
});

describe("logApiCall on a dropped connection", () => {
  const dropped = { error: { message: "TypeError: fetch failed" }, status: 0 };
  const measured = { ...base, status: 200, costUsd: 0.0174, exactCost: true };

  it("retries once when supabase-js returns the failure, and keeps the row", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    insertResults.push(dropped);
    await logApiCall(measured);
    expect(insertCalls).toBe(2);
    expect(inserts).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("retries once when the failure is thrown", async () => {
    insertResults.push(new TypeError("fetch failed"));
    await logApiCall(measured);
    expect(insertCalls).toBe(2);
    expect(inserts).toHaveLength(1);
  });

  it("gives up after the retry with a warning, not an error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insertResults.push(dropped, dropped);
    await logApiCall(measured);
    expect(insertCalls).toBe(2);
    expect(inserts).toHaveLength(0);
    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not retry an error the database answered with", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    insertResults.push({ error: { message: "column does not exist", code: "42703" }, status: 400 });
    await logApiCall(measured);
    expect(insertCalls).toBe(1);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("blockedCall", () => {
  const off = (message: string | null) => ({ allowed: false, apiName: "gemini", blockMode: "block_calls", message, shouldPassKey: false });

  it("logs the blocked call as a 503 at no cost, with its endpoint, time and details, and answers with the switch's message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await blockedCall(off("Gemini paused"), {
      apiName: "gemini",
      endpoint: "/api/ai/regenerate-day",
      startTime: Date.now() - 25,
      metadata: { user_id: "u-1", day_number: 2 },
      disabled: "AI regeneration is currently disabled",
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      api_name: "gemini",
      endpoint: "/api/ai/regenerate-day",
      response_status: 503,
      cache_hit: false,
      cost_usd: 0,
      error_message: "BLOCKED: Gemini paused",
      request_params: { user_id: "u-1", day_number: 2 },
    });
    expect(inserts[0].response_time_ms).toBeGreaterThanOrEqual(25);
    // Nothing ran, so nothing is priced from api_config.
    expect(configReads).toEqual([]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Gemini paused" });
  });

  it("answers with the route's own words when the switch gives none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await blockedCall(off(null), { apiName: "google_geocoding", endpoint: "/geocode/json", startTime: Date.now(), disabled: "Geocoding API is currently disabled" });
    expect(inserts[0]).toMatchObject({ api_name: "google_geocoding", request_params: null });
    expect(await response.json()).toMatchObject({ error: "Geocoding API is currently disabled" });
  });
});
