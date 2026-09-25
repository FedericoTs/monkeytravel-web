// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * "Save to My Trips" on a shared trip.
 *
 * Holding the share token is the permission to open, and so to copy, the
 * trip. The route used to read the source with the signed-in user's own
 * client, and since 20260901090000 RLS hides non-public trips from
 * non-members: every trip shared by link answered 404 to exactly the people
 * the link reached. The source is now read with the service role by exact
 * token and not deleted, the same filter /shared/[token] uses.
 */

const OWNER = "owner-1";
const SAVER = "saver-1";
const TOKEN = "tok-abcdef";

type SourceTrip = { id: string; user_id: string; share_token: string; deleted_at: string | null; visibility: string; is_hidden?: boolean | null };
let caller: string | null;
let stored: SourceTrip[];
const inserted: Array<Record<string, unknown>> = [];
const adminFilters: Array<[string, string, unknown]> = [];

const source = (over: Partial<SourceTrip> = {}): SourceTrip & Record<string, unknown> => ({
  id: "src-1",
  user_id: OWNER,
  share_token: TOKEN,
  deleted_at: null,
  visibility: "private",
  title: "Lisbon Trip",
  description: null,
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  budget: null,
  tags: [],
  itinerary: [{ day_number: 1, date: "2026-10-01", activities: [{ id: "a1", name: "Tram 28" }] }],
  trip_meta: { locale: "en", claimed_at: "2026-09-01T00:00:00Z", claimed_from: "anonymous_share", packing_checked: ["Passport"] },
  packing_list: [],
  ...over,
});

// The service role sees every row; this fake applies the query's own filters.
function fakeAdmin() {
  return {
    from: () => {
      const conds: Array<(t: SourceTrip) => boolean> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          adminFilters.push(["eq", c, v]);
          conds.push((t) => (t as Record<string, unknown>)[c] === v);
          return q;
        },
        is: (c: string, v: unknown) => {
          adminFilters.push(["is", c, v]);
          conds.push((t) => (t as Record<string, unknown>)[c] === v);
          return q;
        },
        not: (c: string, op: string, v: unknown) => {
          adminFilters.push(["not", c, v]);
          // .not(c, "is", true): anything but true (false or null passes).
          conds.push((t) => (t as Record<string, unknown>)[c] !== v);
          return q;
        },
        maybeSingle: async () => ({ data: stored.find((t) => conds.every((ok) => ok(t))) ?? null, error: null }),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

// The caller's own client: RLS hides a private trip from a non-member, so a
// read through it finds nothing. It can insert the caller's own copy.
function fakeUserClient() {
  return {
    from: (table: string) => {
      if (table === "trips") {
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          single: async () => ({ data: null, error: { code: "PGRST116" } }),
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
        };
        return q;
      }
      const q = { select: () => q, eq: () => q, single: async () => ({ data: { referred_by_code: "X" }, error: null }) };
      return q;
    },
  };
}

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () =>
    caller
      ? { user: { id: caller, created_at: "2020-01-01T00:00:00Z" }, supabase: fakeUserClient(), errorResponse: null }
      : { user: null, supabase: fakeUserClient(), errorResponse: new Response(null, { status: 401 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock("@/lib/notifications/scheduling", () => ({ scheduleTripNotifications: vi.fn() }));
vi.mock("@/lib/referral/completion", () => ({ completeReferralIfEligible: async () => ({ wasReferred: false }) }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));

async function save(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/trips/duplicate", { method: "POST", body: JSON.stringify(body) })
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  caller = SAVER;
  stored = [source()];
  inserted.length = 0;
  adminFilters.length = 0;
});

describe("saving a trip someone shared by link", () => {
  it("a non-member holding the token gets their own private copy", async () => {
    const { status, json } = await save({ shareToken: TOKEN });
    expect(status).toBe(200);
    expect(json.tripId).toBeTruthy();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: json.tripId,
      user_id: SAVER,
      title: "Lisbon Trip",
      visibility: "private",
      share_token: null,
    });
  });

  it("reads the source by exact token and only if not deleted", async () => {
    await save({ shareToken: TOKEN });
    expect(adminFilters).toEqual([
      ["eq", "share_token", TOKEN],
      ["is", "deleted_at", null],
      ["not", "is_hidden", true],
    ]);
  });

  it("a trip moderation has hidden cannot be saved", async () => {
    stored = [source({ is_hidden: true })];
    const { status } = await save({ shareToken: TOKEN });
    expect(status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("the copy leaves behind the source owner's claim stamp and packed items", async () => {
    await save({ shareToken: TOKEN });
    expect(inserted[0].trip_meta).toEqual({ locale: "en" });
  });

  it("a deleted trip cannot be saved", async () => {
    stored = [source({ deleted_at: "2026-09-20T00:00:00Z" })];
    const { status } = await save({ shareToken: TOKEN });
    expect(status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("an unknown token is a 404", async () => {
    const { status } = await save({ shareToken: "nope" });
    expect(status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("rejects a missing, non-string or oversized token", async () => {
    expect((await save({})).status).toBe(400);
    expect((await save({ shareToken: 42 })).status).toBe(400);
    expect((await save({ shareToken: "x".repeat(101) })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("asks a signed-out visitor to sign in", async () => {
    caller = null;
    const { status } = await save({ shareToken: TOKEN });
    expect(status).toBe(401);
    expect(inserted).toHaveLength(0);
  });
});
