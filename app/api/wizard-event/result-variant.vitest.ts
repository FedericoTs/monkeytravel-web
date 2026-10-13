/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The result-screen test's arm reaches wizard_step_events.result_variant on
 * the row that carries it, other rows never name the column, and a value
 * outside the test's vocabulary is refused.
 */

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { POST } = await import("./route");
const post = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/wizard-event", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: "mt_session_id=e2eprobe-crew-first" },
    })
  );

beforeEach(() => {
  inserted.length = 0;
});

describe("result_variant", () => {
  it("is stored on the row that carries it", async () => {
    expect((await post({ step: "result", group_size: "group", result_variant: "crew_first" })).status).toBe(204);
    expect(inserted[0]).toMatchObject({ step: "result", session_id: "e2eprobe-crew-first", result_variant: "crew_first" });
  });

  it("is left out of rows that do not carry it", async () => {
    await post({ step: "saved" });
    expect(inserted[0]).not.toHaveProperty("result_variant");
  });

  it("refuses a value outside the test", async () => {
    expect((await post({ step: "result", result_variant: "treatment" })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
