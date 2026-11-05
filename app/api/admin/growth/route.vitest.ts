// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import type { GrowthStats } from "@/lib/admin/growth/types";

/**
 * The Growth tab reads whole tables with the service role. The real route runs over
 * rows answered as PostgREST answers them, at most 1,000 per request. The numbers
 * themselves are in lib/admin/growth/stats.vitest.ts.
 */

const s = vi.hoisted(() => ({
  admin: true,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  refused: {} as Record<string, string>,
  breaks: false,
  log: [] as unknown[],
}));

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedAdmin: async () => ({
    errorResponse: s.admin ? null : Response.json({ error: "Forbidden" }, { status: 403 }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q: FakeQuery) => {
      if (s.breaks) throw new Error("connection lost");
      if (s.refused[q.table]) return { data: null, error: { message: s.refused[q.table] } };
      const from = q.filters.find(([op, column]) => op === "gte" && column === "id")?.[2] as string | undefined;
      const hits = (s.tables[q.table] ?? [])
        .filter((row) => !from || String(row.id) >= from)
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      return { data: hits.slice(0, Math.min(q.limitTo ?? 1000, 1000)), error: null };
    });
    s.log = db.log;
    return db.client;
  },
}));

const { GET } = await import("./route");

const id = (prefix: string, i: number) => `${prefix}-${String(i).padStart(6, "0")}`;
const reads = () => s.log as FakeQuery[];

async function growth() {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as GrowthStats };
}

beforeEach(() => {
  s.admin = true;
  s.tables = {};
  s.refused = {};
  s.breaks = false;
  s.log = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Growth tab", () => {
  it("counts every row, past what one request answers", async () => {
    s.tables.users = Array.from({ length: 1200 }, (_, i) => ({ id: id("user", i), created_at: "2026-01-01T00:00:00Z" }));
    s.tables.trips = Array.from({ length: 1500 }, (_, i) => ({ id: id("trip", i), user_id: id("user", i % 1200), created_at: "2026-02-01T00:00:00Z" }));
    const { body } = await growth();
    expect(body.funnel.acquisition.count).toBe(1200);
    expect(body.lifecycle).toEqual({ new: 0, activated: 900, engaged: 300, powerUser: 0 });
    expect(body.collaboration.funnel.tripsCreated).toBe(1500);
  });

  it("leaves templates out of the trips", async () => {
    s.tables.trips = [
      { id: "t1", user_id: "a", created_at: "2026-02-01T00:00:00Z", is_template: false },
      { id: "t2", user_id: "a", created_at: "2026-02-01T00:00:00Z", is_template: true },
    ];
    expect((await growth()).body.collaboration.funnel.tripsCreated).toBe(1);
  });

  it("asks for columns the tables have", async () => {
    await growth();
    const columns = (table: string) => reads().find((q) => q.table === table)?.columns;
    expect(columns("referral_tiers")).toBe("id, user_id, tier_1_unlocked_at, tier_2_unlocked_at, tier_3_unlocked_at");
    expect(columns("banana_redemption_catalog")).toBe("id, name");
  });

  it("names a read that failed, and still counts the rest", async () => {
    s.refused.proposal_votes = "column does not exist";
    s.tables.users = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];
    const { status, body } = await growth();
    expect(status).toBe(200);
    expect(body.meta.dataWarnings).toEqual(["proposal_votes: column does not exist"]);
    expect(body.funnel.acquisition.count).toBe(1);
    expect(body.collaboration.totalProposalVotes).toBe(0);
  });

  it("warns of nothing when every read worked", async () => {
    expect((await growth()).body.meta.dataWarnings).toEqual([]);
  });

  it("is only for admins, and reads nothing for anyone else", async () => {
    s.admin = false;
    expect((await growth()).status).toBe(403);
    expect(s.log).toEqual([]);
  });

  it("answers 500 when something unexpected breaks", async () => {
    s.breaks = true;
    expect((await growth()).status).toBe(500);
  });
});
