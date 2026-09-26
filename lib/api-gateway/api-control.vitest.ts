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

import { logApiCall } from "./api-control";

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
