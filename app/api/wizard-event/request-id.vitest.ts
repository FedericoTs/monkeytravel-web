/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A `generation_failed` row names the generation it waited for and how long it
 * waited, so it joins to the server's row; other rows never name the columns.
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
      headers: { "content-type": "application/json", cookie: "mt_session_id=e2eprobe-request-id" },
    })
  );
const ID = "7f9c2a4e-1b3d-4c5e-8f6a-0b1c2d3e4f5a";

beforeEach(() => {
  inserted.length = 0;
});

describe("request_id and elapsed_ms", () => {
  it("are stored on the failure that carries them", async () => {
    const res = await post({ step: "generation_failed", failure_code: "network", request_id: ID, elapsed_ms: 68_000 });
    expect(res.status).toBe(204);
    expect(inserted[0]).toMatchObject({ step: "generation_failed", failure_code: "network", request_id: ID, elapsed_ms: 68_000 });
  });

  it("are left out of rows that do not carry them", async () => {
    await post({ step: "result" });
    expect(inserted[0]).not.toHaveProperty("request_id");
    expect(inserted[0]).not.toHaveProperty("elapsed_ms");
  });

  it("refuse a malformed id or a negative wait", async () => {
    expect((await post({ step: "generation_failed", request_id: "abc" })).status).toBe(400);
    expect((await post({ step: "generation_failed", elapsed_ms: -1 })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
