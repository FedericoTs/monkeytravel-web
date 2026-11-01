/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Pages cached while the result-screen test ran still send their arm
 * (`result_variant`). The event lands, and the arm is not stored: the column
 * keeps the test's sessions only.
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

describe("result_variant from a cached page", () => {
  it("is accepted and not stored", async () => {
    for (const result_variant of ["crew_first", "control", "treatment"]) {
      inserted.length = 0;
      expect((await post({ step: "result", group_size: "group", result_variant })).status).toBe(204);
      expect(inserted[0]).toMatchObject({ step: "result", session_id: "e2eprobe-crew-first" });
      expect(inserted[0]).not.toHaveProperty("result_variant");
    }
  });
});
