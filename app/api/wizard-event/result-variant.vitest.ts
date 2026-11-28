/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * No test draws a result screen any more (the sky test ended with
 * the classic screen kept). Pages cached from before still send an arm under
 * `result_variant`: the event lands, and the arm is never kept.
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
      headers: { "content-type": "application/json", cookie: "mt_session_id=e2eprobe-sky-test" },
    })
  );

beforeEach(() => {
  inserted.length = 0;
});

describe("result_variant", () => {
  it("from a cached page of an ended test lands without its arm, on a result row or any other", async () => {
    for (const step of ["result", "saved"]) {
      for (const result_variant of ["sky", "classic", "crew_first", "control"]) {
        inserted.length = 0;
        expect((await post({ step, result_variant })).status).toBe(204);
        expect(inserted[0]).toMatchObject({ step, session_id: "e2eprobe-sky-test" });
        expect(inserted[0]?.result_variant ?? null).toBeNull();
      }
    }
  });

  it("is simply absent when not sent", async () => {
    expect((await post({ step: "result" })).status).toBe(204);
    expect(inserted[0]).toMatchObject({ step: "result", session_id: "e2eprobe-sky-test" });
    expect(inserted[0]?.result_variant ?? null).toBeNull();
  });
});
