// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * A new checklist item goes after the last one. The position comes from a
 * read of the highest sort_order, so a read the database refused adds
 * nothing, rather than filing the item at the top as if the list were empty.
 */

const TRIP = "trip-1";
let lastItem: { sort_order: number } | null;
let readError: { message: string } | null;
const inserted: Array<Record<string, unknown>> = [];

function fakeSupabase() {
  return {
    from: () => {
      let row: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        insert: (r: Record<string, unknown>) => ((row = r), inserted.push(r), q),
        maybeSingle: async () => (readError ? { data: null, error: readError } : { data: lastItem, error: null }),
        single: async () => {
          if (row) return { data: { id: "item-1", ...row }, error: null };
          if (readError) return { data: null, error: readError };
          return lastItem ? { data: lastItem, error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
        },
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "owner-1" }, supabase: fakeSupabase(), errorResponse: null }),
  verifyTripOwnership: async () => ({ trip: { id: TRIP, user_id: "owner-1" }, errorResponse: null }),
}));

async function add(text: string) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/checklist`, { method: "POST", body: JSON.stringify({ text }) }),
    { params: Promise.resolve({ id: TRIP }) }
  );
  return res.status;
}

beforeEach(() => {
  lastItem = null;
  readError = null;
  inserted.length = 0;
});

describe("where a new checklist item goes", () => {
  it("after the last one", async () => {
    lastItem = { sort_order: 4 };
    expect(await add("Passport")).toBe(201);
    expect(inserted[0].sort_order).toBe(5);
  });

  it("first, on an empty checklist", async () => {
    expect(await add("Passport")).toBe(201);
    expect(inserted[0].sort_order).toBe(1);
  });

  it("nowhere, when the last position can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readError = { message: "canceling statement due to statement timeout" };
    expect(await add("Passport")).toBe(500);
    expect(inserted).toHaveLength(0);
  });
});
