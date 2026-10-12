import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * logApiCall's cost: a measured cost is logged as is, even 0. A plain 0 still
 * means "use api_config's flat cost_per_request", which books $0.003 for a
 * Gemini call that never ran.
 */

const inserts: Record<string, unknown>[] = [];
const configReads: string[] = [];
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
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, apiName: string) => ({
          single: async () => {
            configReads.push(apiName);
            return {
              data: {
                api_name: apiName,
                display_name: apiName,
                enabled: true,
                block_mode: "none",
                category: "ai",
                cost_per_request: "0.003",
              },
              error: null,
            };
          },
        }),
      }),
    }),
  }),
}));

import { logApiCall, logApiCalls } from "./api-control";

const base = { apiName: "gemini", endpoint: "/api/ai/generate", status: 500, responseTimeMs: 10, cacheHit: false };

beforeEach(() => {
  inserts.length = 0;
  configReads.length = 0;
  insertResults.length = 0;
  insertCalls = 0;
  vi.restoreAllMocks();
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
