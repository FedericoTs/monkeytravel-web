// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Who may read a trip through GET /api/trips/[id].
 *
 * Owner-only until 2026-09-25. The trip page re-reads through it after every
 * assistant change, so once invited editors could use the assistant, their
 * change was saved and the re-read answered 404: an error banner and a stale
 * plan, and their next save conflicted with their own change. Members may now
 * read the trip, as RLS and the trip page already let them. The real
 * verifyTripAccess runs against a fake Supabase.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshItineraryPhotos: async (x: unknown) => x }));

let caller: string;
let roles: Record<string, string>;
let visible: boolean;

function fakeSupabase() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters[c] = v;
          return q;
        },
        single: async () => {
          if (table === "trips") {
            // Honours a user_id filter, as the database would (the old
            // owner-only read filtered on it).
            const ownerFilterMisses = "user_id" in filters && filters.user_id !== OWNER;
            return visible && !ownerFilterMisses
              ? { data: { id: TRIP, user_id: OWNER, title: "Lisbon", itinerary: [] }, error: null }
              : { data: null, error: { code: "PGRST116" } };
          }
          const role = roles[String(filters.user_id)];
          return { data: role ? { role } : null, error: null };
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

async function read() {
  const { GET } = await import("./route");
  const res = await GET(new NextRequest(`http://localhost/api/trips/${TRIP}`), { params: Promise.resolve({ id: TRIP }) });
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  caller = OWNER;
  roles = { "mate-1": "editor", "voter-1": "voter", "viewer-1": "viewer" };
  visible = true;
});

describe("GET /api/trips/[id]", () => {
  it("the owner and every member can read the trip", async () => {
    for (const who of [OWNER, "mate-1", "voter-1", "viewer-1"]) {
      caller = who;
      const { status, json } = await read();
      expect(status).toBe(200);
      expect(json.trip.id).toBe(TRIP);
    }
  });

  it("a stranger who can see a public trip still cannot read it here", async () => {
    caller = "stranger";
    expect((await read()).status).toBe(403);
  });

  it("a trip RLS hides is a 404", async () => {
    caller = "stranger";
    visible = false;
    expect((await read()).status).toBe(404);
  });
});
