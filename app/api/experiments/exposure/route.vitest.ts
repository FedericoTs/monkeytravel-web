/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * An exposure is recorded once per experiment and session, for an experiment and arm the registry knows, with the
 * session from the cookie, through the service role.
 */

const upserts: Array<{ row: Record<string, unknown>; options: Record<string, unknown> }> = [];
let failWrite = false;
let limited: "ip" | "session" | null = null;
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (name: string) => ({
    check: async () => ({ allowed: !(limited && name.endsWith(limited)), remaining: 1 }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, options: Record<string, unknown>) => {
        expect(table).toBe("experiment_exposures");
        upserts.push({ row, options });
        return { error: failWrite ? { message: "boom" } : null };
      },
    }),
  }),
}));

const { POST } = await import("./route");
const post = (body: unknown, cookie = "mt_session_id=e2eprobe-exposure-test") =>
  POST(
    new NextRequest("https://monkeytravel.app/api/experiments/exposure", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    }),
  );

beforeEach(() => {
  upserts.length = 0;
  failWrite = false;
  limited = null;
});

describe("POST /api/experiments/exposure", () => {
  it("records the arm once per experiment and session", async () => {
    expect((await post({ experiment: "step2_default", arm: "data" })).status).toBe(204);
    expect(upserts).toEqual([
      {
        row: { experiment: "step2_default", arm: "data", session_id: "e2eprobe-exposure-test" },
        options: { onConflict: "experiment,session_id", ignoreDuplicates: true },
      },
    ]);
  });

  it("refuses an experiment or an arm the registry doesn't know, and a malformed body", async () => {
    expect((await post({ experiment: "no_such", arm: "data" })).status).toBe(400);
    expect((await post({ experiment: "step2_default", arm: "sky" })).status).toBe(400);
    expect((await post({ experiment: "step2_default" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect(upserts).toEqual([]);
  });

  it("records nothing without a session", async () => {
    expect((await post({ experiment: "step2_default", arm: "data" }, "")).status).toBe(204);
    expect(upserts).toEqual([]);
  });

  it("writes outside production only for the probes' sessions", async () => {
    expect((await post({ experiment: "step2_default", arm: "data" }, "mt_session_id=a-visitor")).status).toBe(204);
    expect(upserts).toEqual([]);
  });

  it("answers 429 over either limit, without writing", async () => {
    limited = "ip";
    expect((await post({ experiment: "step2_default", arm: "data" })).status).toBe(429);
    limited = "session";
    expect((await post({ experiment: "step2_default", arm: "data" })).status).toBe(429);
    expect(upserts).toEqual([]);
  });

  it("answers 500 when the write fails", async () => {
    failWrite = true;
    expect((await post({ experiment: "step2_default", arm: "data" })).status).toBe(500);
  });
});
