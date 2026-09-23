// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Only signed-in saves move trips.save_count.
 *
 * An anonymous save is keyed by a cookie the visitor controls: drop it and the
 * next request mints a fresh one. Counting those would let anyone push any
 * public trip's save count and trending score up with one cookieless request
 * per point. They were never counted in practice (the anon role cannot execute
 * the counter), and when the calls moved to the service role on 2026-09-23 the
 * route had to say so explicitly, or anonymous saves would start counting and
 * anonymous unsaves would subtract saves that signed-in people made.
 */

const runTripCounter = vi.fn();

vi.mock("@/lib/explore/counters", () => ({
  runTripCounter: (...a: unknown[]) => runTripCounter(...a),
}));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => {} }));

type Opts = { user: { id: string } | null; saveCount: number; deletedRows: number };
let opts: Opts;

function tripSavesTable() {
  return {
    insert: async () => ({ error: null }),
    delete: () => ({
      eq: () => ({
        eq: () => ({
          select: async () => ({
            data: Array.from({ length: opts.deletedRows }, (_, i) => ({ id: `s${i}` })),
            error: null,
          }),
        }),
      }),
    }),
  };
}

function tripsTable() {
  let cols = "";
  const q = {
    select(c: string) {
      cols = c;
      return q;
    },
    eq: () => q,
    single: async () =>
      cols.includes("save_count")
        ? { data: { save_count: opts.saveCount }, error: null }
        : { data: { id: "trip-1", visibility: "public", is_hidden: false }, error: null },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from: (t: string) => (t === "trips" ? tripsTable() : tripSavesTable()),
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => tripSavesTable() }),
}));

const ctx = { params: Promise.resolve({ id: "trip-1" }) };

function req(method: "POST" | "DELETE", cookie?: string) {
  return new NextRequest("https://monkeytravel.app/api/trips/trip-1/save", {
    method,
    headers: cookie ? { cookie: `mt_saver_cookie=${cookie}` } : {},
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  runTripCounter.mockReset();
  opts = { user: null, saveCount: 3, deletedRows: 1 };
});

describe("POST /api/trips/[id]/save", () => {
  it("counts a signed-in save through the service-role counter", async () => {
    opts.user = { id: "u1" };
    runTripCounter.mockResolvedValue(4);
    const { POST } = await import("./route");

    const res = await POST(req("POST"), ctx);
    expect(runTripCounter).toHaveBeenCalledWith("increment_trip_save_count", "trip-1", "trip-save");
    expect(await res.json()).toMatchObject({ saved: true, count: 4 });
  });

  it("does not count an anonymous save, and shows the visitor their own save", async () => {
    const { POST } = await import("./route");

    const res = await POST(req("POST"), ctx);
    expect(runTripCounter).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ saved: true, count: 4 });
  });
});

describe("DELETE /api/trips/[id]/save", () => {
  it("takes one off for a signed-in unsave that removed a row", async () => {
    opts.user = { id: "u1" };
    runTripCounter.mockResolvedValue(2);
    const { DELETE } = await import("./route");

    const res = await DELETE(req("DELETE"), ctx);
    expect(runTripCounter).toHaveBeenCalledWith("decrement_trip_save_count", "trip-1", "trip-unsave");
    expect(await res.json()).toMatchObject({ saved: false, count: 2 });
  });

  it("leaves the counter alone for a signed-in unsave that removed nothing", async () => {
    opts.user = { id: "u1" };
    opts.deletedRows = 0;
    const { DELETE } = await import("./route");

    const res = await DELETE(req("DELETE"), ctx);
    expect(runTripCounter).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ saved: false, count: 3 });
  });

  it("never subtracts for an anonymous unsave, which was never counted", async () => {
    const { DELETE } = await import("./route");

    const res = await DELETE(req("DELETE", "abc123"), ctx);
    expect(runTripCounter).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ saved: false, count: 3 });
  });
});
