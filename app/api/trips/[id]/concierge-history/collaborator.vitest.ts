// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Concierge history for collaborators.
 *
 * Collaborators can ask the Concierge on the trip page, but the history route
 * was owner-only and 404'd for them. Any member may now read it, and each
 * person still sees only their own turns.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

const historyFilters: Array<[string, unknown]> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          historyFilters.push([c, v]);
          return q;
        },
        order: () => q,
        limit: async () => ({ data: [], error: null }),
      };
      return q;
    },
  }),
}));

let caller = OWNER;
let role: string | null = null;
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    getAuthenticatedUser: async () => ({
      user: { id: caller },
      errorResponse: null,
      supabase: {
        from(table: string) {
          const q = {
            select: () => q,
            eq: () => q,
            single: async () =>
              table === "trip_collaborators"
                ? { data: role ? { role } : null, error: null }
                : { data: { id: TRIP, user_id: OWNER }, error: null },
          };
          return q;
        },
      },
    }),
  };
});

import { GET } from "./route";

const call = () =>
  GET(new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/concierge-history`), {
    params: Promise.resolve({ id: TRIP }),
  } as never);

beforeEach(() => {
  historyFilters.length = 0;
  caller = OWNER;
  role = null;
});

describe("GET concierge-history", () => {
  it("answers an editor with only their own turns", async () => {
    caller = "editor-1";
    role = "editor";
    expect((await call()).status).toBe(200);
    expect(historyFilters).toContainEqual(["user_id", "editor-1"]);
    expect(historyFilters).not.toContainEqual(["user_id", OWNER]);
  });

  it("still answers the owner", async () => {
    expect((await call()).status).toBe(200);
    expect(historyFilters).toContainEqual(["user_id", OWNER]);
  });

  it("refuses someone who is not a member", async () => {
    caller = "stranger";
    expect((await call()).status).toBe(403);
    expect(historyFilters).toHaveLength(0);
  });
});
