// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Undo puts back the itinerary from before an assistant change, but only while
 * the trip is still as that change left it: putting the old copy back over a
 * later save would wipe the save. The real route runs against a fake table.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));

const act = (id: string, name: string) => ({ id, name, type: "culture", start_time: "09:00", duration_minutes: 60 });
const before = [{ day_number: 1, date: "2026-11-24", activities: [act("a1", "Alpha"), act("a2", "Bravo")] }];
const after = [{ day_number: 1, date: "2026-11-24", activities: [act("a1", "Alpha"), act("n1", "Charlie")] }];

let caller: string;
let roles: Record<string, string>;
let refuseWrites: boolean;
let row: { id: string; user_id: string; itinerary: unknown; itinerary_version: number; end_date: string };
let writes: Array<Record<string, unknown>>;

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const filters: Record<string, unknown> = {};
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => ((filters[c] = v), q),
          maybeSingle: async () => {
            const role = roles[String(filters.user_id)];
            return { data: role ? { role } : null, error: null };
          },
        };
        return q;
      }
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      const q = {
        select: () => (values ? commit() : q),
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        update: (v: Record<string, unknown>) => ((values = v), q),
        single: async () => ({ data: { ...row }, error: null }),
        maybeSingle: async () => ({ data: { itinerary_version: row.itinerary_version }, error: null }),
      };
      const commit = async () => {
        const versionOk = !("itinerary_version" in filters) || filters.itinerary_version === row.itinerary_version;
        if (refuseWrites || !versionOk) return { data: [], error: null };
        writes.push(values!);
        row = { ...row, ...(values as object), itinerary_version: row.itinerary_version + 1 };
        return { data: [{ id: TRIP }], error: null };
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
}));

async function undo(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant/undo", { method: "POST", body: JSON.stringify({ tripId: TRIP, ...body }) }),
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  caller = OWNER;
  roles = { "mate-1": "editor", "viewer-1": "viewer" };
  refuseWrites = false;
  writes = [];
  // The trip right after the change, written at version 5.
  row = { id: TRIP, user_id: OWNER, itinerary: after, itinerary_version: 5, end_date: "2026-11-24" };
});

describe("POST /api/ai/assistant/undo", () => {
  it("puts the old itinerary back while the trip is as the change left it", async () => {
    const { status } = await undo({ previousItinerary: before, expectedVersion: 5 });
    expect(status).toBe(200);
    expect(row.itinerary).toEqual(before);
  });

  it("refuses with 409 OUTDATED once a later save has moved the trip on, and writes nothing", async () => {
    row.itinerary_version = 6;
    const { status, json } = await undo({ previousItinerary: before, expectedVersion: 5 });
    expect(status).toBe(409);
    expect(json.code).toBe("OUTDATED");
    expect(writes).toHaveLength(0);
    expect(row.itinerary).toEqual(after);
  });

  it("still undoes for a page that sends no version", async () => {
    const { status } = await undo({ previousItinerary: before });
    expect(status).toBe(200);
    expect(row.itinerary).toEqual(before);
  });

  it("answers 500, not success, when the write is refused", async () => {
    refuseWrites = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status } = await undo({ previousItinerary: before, expectedVersion: 5 });
    expect(status).toBe(500);
  });

  it("lets an editor undo, but not a viewer", async () => {
    caller = "mate-1";
    expect((await undo({ previousItinerary: before, expectedVersion: 5 })).status).toBe(200);
    caller = "viewer-1";
    const { status, json } = await undo({ previousItinerary: after, expectedVersion: 6 });
    expect(status).toBe(403);
    expect(json.code).toBe("NOT_ALLOWED");
  });

  it("needs an itinerary to put back", async () => {
    expect((await undo({ previousItinerary: "not a list" })).status).toBe(400);
  });
});
