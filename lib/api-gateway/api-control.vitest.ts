import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * logApiCall's cost: a measured cost is logged as is, even 0. A plain 0 still
 * means "use api_config's flat cost_per_request", which books $0.003 for a
 * Gemini call that never ran.
 */

const inserts: Record<string, unknown>[] = [];
const configReads: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
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
