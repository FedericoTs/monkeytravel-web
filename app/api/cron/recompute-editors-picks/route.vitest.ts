// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The run reports success only when every step landed: a failed read or
 * write answers 500, so a stale Editor's Pick shows up in the cron's status.
 */

let failOn: ((q: FakeQuery) => boolean) | null;
const db = () =>
  fakeSupabase((q) => {
    if (failOn?.(q)) return { data: null, error: { message: "boom" } };
    if (q.op === "update") return { data: null, error: null };
    // Eligible now: t1, t2. Picked before: t2, t3 (t3 no longer qualifies).
    const picked = q.filters.some(([op, c]) => op === "eq" && c === "is_editors_pick");
    return { data: picked ? [{ id: "t2" }, { id: "t3" }] : [{ id: "t1" }, { id: "t2" }], error: null };
  }).client;
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db() }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
vi.stubEnv("CRON_SECRET", "cron-secret");
vi.spyOn(console, "error").mockImplementation(() => {});

const { GET } = await import("./route");
const run = () =>
  GET(new NextRequest("http://localhost/api/cron/recompute-editors-picks", { headers: { authorization: "Bearer cron-secret" } }));

beforeEach(() => {
  failOn = null;
});

describe("GET recompute-editors-picks", () => {
  it("flags the eligible trips and unflags the rest", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, eligibleCount: 2, unflaggedCount: 1 });
  });

  it("answers 500 when a step fails", async () => {
    const steps: Array<(q: FakeQuery) => boolean> = [
      (q) => q.op === "select" && q.filters.some(([op, c]) => op === "eq" && c === "is_editors_pick"),
      (q) => q.op === "update" && (q.value as { is_editors_pick: boolean }).is_editors_pick === false,
      (q) => q.op === "update" && (q.value as { is_editors_pick: boolean }).is_editors_pick === true,
    ];
    for (const step of steps) {
      failOn = step;
      expect((await run()).status).toBe(500);
    }
  });
});
