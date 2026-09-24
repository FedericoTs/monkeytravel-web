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
 * mints one for whoever it is given.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";
const TOKEN = "tok-123";

const rpc = vi.fn(async () => ({ data: "OWNERCODE", error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/images/enrichTrip", () => ({ enrichTripByIdAdmin: vi.fn() }));
vi.mock("@/lib/analytics/funnel-events", () => ({ logFunnelEventServer: vi.fn() }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));

let caller = OWNER;
let role: string | null = null;

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const q = { select: () => q, eq: () => q, single: async () => ({ data: role ? { role } : null, error: null }) };
        return q;
      }
      // trips: owner-only reads filter .eq("user_id", caller); honour that.
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        single: async () => {
          const byUser = filters.find(([c]) => c === "user_id");
          if (byUser && byUser[1] !== OWNER) return { data: null, error: { code: "PGRST116" } };
          return {
            data: { id: TRIP, user_id: OWNER, share_token: TOKEN, shared_at: "2026-09-24T10:43:32Z", visibility: "shared" },
            error: null,
          };
        },
        update: () => q,
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

const ctx = { params: Promise.resolve({ id: TRIP }) } as never;
const req = (method = "GET") => new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/share`, { method });

beforeEach(() => {
  vi.clearAllMocks();
  caller = OWNER;
  role = null;
});

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

  it("still answers the owner", async () => {
    expect((await GET(req(), ctx)).status).toBe(200);
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
  });
});
