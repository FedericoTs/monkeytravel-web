// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Reading a trip's share status.
 *
 * ShareButton asks on mount for every role, and the route was owner-only, so
 * every collaborator's trip page logged a 404 (seen 2026-09-24). Any member
 * may now read it; creating and revoking the link stay with the owner. The
 * link must carry the OWNER's referral code: get_or_create_referral_code
 * mints one for whoever it is given. Stopping sharing also takes a trip off
 * Explore, so sharing it again must not report it as listed. The token comes
 * from the service role (the user-scoped client may not select it), and
 * unpublishing gives it a new one, which the status then reports.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";
const TOKEN = "tok-123";
const LISTED = {
  id: TRIP,
  user_id: OWNER,
  share_token: TOKEN as string | null,
  shared_at: "2026-09-24T10:43:32Z" as string | null,
  visibility: "public",
  submitted_to_trending_at: "2026-09-25T08:00:00Z" as string | null,
};

const rpc = vi.fn(async () => ({ data: "OWNERCODE", error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/images/enrichTrip", () => ({ enrichTripByIdAdmin: vi.fn() }));
vi.mock("@/lib/analytics/funnel-events", () => ({ logFunnelEventServer: vi.fn() }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/lib/seo/trip-card-cache", () => ({ purgeTripCard: vi.fn() }));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: vi.fn() }));
// The service-role read of the stored trip's token.
vi.mock("@/lib/trips/share-token", () => ({ readShareToken: async () => row.share_token }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

let caller = OWNER;
let role: string | null = null;
// The stored trip; owner writes land on it.
let row: typeof LISTED;
const updates: Array<Record<string, unknown>> = [];

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const q = { select: () => q, eq: () => q, single: async () => ({ data: role ? { role } : null, error: null }) };
        return q;
      }
      // trips: owner-only reads filter .eq("user_id", caller); honour that.
      // The column grant refuses share_token and "*" to this client.
      const filters: Array<[string, unknown]> = [];
      let cols = "";
      const q = {
        select: (c = "*") => ((cols = c), q),
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        single: async () => {
          if (/share_token|\*/.test(cols)) return { data: null, error: { code: "42501" } };
          const byUser = filters.find(([c]) => c === "user_id");
          if (byUser && byUser[1] !== OWNER) return { data: null, error: { code: "PGRST116" } };
          return { data: { ...row }, error: null };
        },
        update: (u: Record<string, unknown>) => {
          updates.push(u);
          row = { ...row, ...u };
          return q;
        },
      };
      return q;
    },
  };
}

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
  };
});

import { GET, POST, DELETE } from "./route";
import { DELETE as UNPUBLISH } from "../publish/route";

const ctx = { params: Promise.resolve({ id: TRIP }) } as never;
const req = (method = "GET") => new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/share`, { method });

beforeEach(() => {
  vi.clearAllMocks();
  caller = OWNER;
  role = null;
  row = { ...LISTED };
  updates.length = 0;
});

const status = async () => {
  const body = await (await GET(req(), ctx)).json();
  return body.data ?? body;
};

describe("GET share status", () => {
  it.each(["editor", "voter", "viewer"])("answers a %s with the link, carrying the owner's code", async (r) => {
    caller = "member-1";
    role = r;
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.data ?? body).isShared).toBe(true);
    expect(rpc).toHaveBeenCalledWith("get_or_create_referral_code", { p_user_id: OWNER });
  });

  it("still answers the owner, including whether the trip is in Explore", async () => {
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.data ?? body).isInTrending).toBe(true);
    expect(rpc).toHaveBeenCalledWith("get_or_create_referral_code", { p_user_id: OWNER });
  });

  it("refuses someone who is not a member", async () => {
    caller = "stranger";
    expect((await GET(req(), ctx)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("creating and revoking stay with the owner", () => {
  it("an editor cannot create or revoke the link", async () => {
    caller = "member-1";
    role = "editor";
    expect((await POST(req("POST"), ctx)).status).toBe(404);
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(404);
    expect(updates).toEqual([]);
  });
});

describe("stopping sharing a trip on Explore", () => {
  it("takes it off Explore and clears its listing stamp, as unpublishing does", async () => {
    expect((await DELETE(req("DELETE"), ctx)).status).toBe(200);
    expect(updates).toEqual([{ share_token: null, shared_at: null, visibility: "private", submitted_to_trending_at: null }]);
  });

  it("sharing it again does not report it as listed", async () => {
    await DELETE(req("DELETE"), ctx);
    expect((await POST(req("POST"), ctx)).status).toBe(200);
    expect(row.visibility).toBe("shared");
    expect(await status()).toMatchObject({ isShared: true, isInTrending: false });
  });

  it("a shared trip still carrying a stamp is not reported as listed", async () => {
    row = { ...LISTED, visibility: "shared" };
    expect((await status()).isInTrending).toBe(false);
  });
});

describe("unpublishing a listed trip", () => {
  it("keeps it shared under a new token, and the status hands out that token", async () => {
    const res = await UNPUBLISH(new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/publish`, { method: "DELETE" }), {
      params: Promise.resolve({ id: TRIP }),
    });
    expect(res.status).toBe(200);
    expect(row.share_token).toBeTruthy();
    expect(row.share_token).not.toBe(TOKEN);
    const shown = await status();
    expect(shown).toMatchObject({ isShared: true, shareToken: row.share_token, visibility: "shared", isInTrending: false });
    expect(shown.shareUrl).toContain(`/shared/${row.share_token}`);
    expect(shown.shareUrl).not.toContain(TOKEN);
  });
});
