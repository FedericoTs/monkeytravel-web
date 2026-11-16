/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * When the engine's first answer broke one of its rules and got one more try,
 * the log row says which rule and which answer stood, so the daily report can
 * count them. Kept even when the turn changed nothing.
 */

const assistTrip = vi.fn();
const rows: Record<string, unknown>[] = [];

vi.mock("@/lib/ai/assistant/engine", () => ({ assistTrip: (input: unknown) => assistTrip(input), MAX_TRIP_DAYS_MULTI: 21 }));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => null }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

import { POST } from "./route";

const ask = () =>
  POST(
    new NextRequest("http://localhost/api/ai/assistant-anon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "add a gelato stop on day 1",
        destination: "Rome, Italy",
        tripTitle: "Rome",
        days: [{ day_number: 1, activities: [] }],
      }),
    })
  );

const meta = { model: "m", costUsd: 0, generationTimeMs: 1 };

beforeEach(() => {
  assistTrip.mockReset();
  rows.length = 0;
});

describe("the log row of a corrected answer", () => {
  it("says which rule and which answer stood", async () => {
    assistTrip.mockResolvedValue({
      reply: "Done.",
      edits: [{ day_number: 1, summary: "", activities: [{ name: "Gelato at Giolitti" }] }],
      corrected: { rule: "named_day", answer: "second" },
      meta,
    });
    expect((await ask()).status).toBe(200);
    expect(rows[0]?.edit).toMatchObject({ days: [1], corrected: { rule: "named_day", answer: "second" } });
  });

  it("is written when the turn changed nothing", async () => {
    assistTrip.mockResolvedValue({ reply: "I couldn't fit it.", edits: [], corrected: { rule: "named_day", answer: "first" }, meta });
    await ask();
    expect(rows[0]?.edit).toMatchObject({ days: [], corrected: { rule: "named_day", answer: "first" } });
  });

  it("has none on an answer the engine didn't correct", async () => {
    assistTrip.mockResolvedValue({ reply: "Done.", edits: [{ day_number: 1, summary: "", activities: [{ name: "Gelato at Giolitti" }] }], meta });
    await ask();
    expect(rows[0]?.edit).not.toHaveProperty("corrected");
  });
});
