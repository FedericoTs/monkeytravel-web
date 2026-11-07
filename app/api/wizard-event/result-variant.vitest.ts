/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The sky test's arm (`result_variant`) is kept on `result` rows. Pages cached
 * from the retired crew-first test still send its arms: the event lands, and
 * the arm is not kept.
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
  it("keeps the sky test's arm on a result row", async () => {
    for (const result_variant of ["sky", "classic"]) {
      inserted.length = 0;
      expect((await post({ step: "result", result_variant })).status).toBe(204);
      expect(inserted[0]).toMatchObject({ step: "result", session_id: "e2eprobe-sky-test", result_variant });
    }
  });

  it("isn't kept on any other step", async () => {
    expect((await post({ step: "saved", result_variant: "sky" })).status).toBe(204);
    expect(inserted[0]?.result_variant).toBeNull();
  });

  it("from a cached page of the retired test, or anything else, lands without its arm", async () => {
    for (const result_variant of ["crew_first", "control", "treatment"]) {
      inserted.length = 0;
      expect((await post({ step: "result", group_size: "group", result_variant })).status).toBe(204);
      expect(inserted[0]).toMatchObject({ step: "result", session_id: "e2eprobe-sky-test" });
      expect(inserted[0]?.result_variant).toBeNull();
    }
  });

  it("is simply absent when not sent", async () => {
    expect((await post({ step: "result" })).status).toBe(204);
    expect(inserted[0]?.result_variant).toBeNull();
  });
});
