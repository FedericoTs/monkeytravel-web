// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Taking a trip off Explore leaves its share link working, so a trip that has
 * one goes back to "shared", not "private".
 */

const OWNER = "owner-1";
let shareToken: string | null = "tok";
const updates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/lib/seo/trip-card-cache", () => ({ purgeTripCard: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: OWNER },
    errorResponse: null,
    supabase: {
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          update: (u: Record<string, unknown>) => (updates.push(u), q),
          single: async () => ({ data: { id: "trip-1", user_id: OWNER, share_token: shareToken }, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
        return q;
      },
    },
  }),
}));

const { DELETE } = await import("./route");

async function unlist() {
  const res = await DELETE(new NextRequest("http://localhost/api/trips/trip-1/publish", { method: "DELETE" }), {
    params: Promise.resolve({ id: "trip-1" }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  updates.length = 0;
});

describe("DELETE /api/trips/[id]/publish", () => {
  it("keeps a trip with a share link shared", async () => {
    shareToken = "tok";
    const { status, body } = await unlist();
    expect(status).toBe(200);
    expect(updates).toEqual([{ visibility: "shared", submitted_to_trending_at: null }]);
    expect(body.visibility).toBe("shared");
  });

  it("makes a trip without one private", async () => {
    shareToken = null;
    const { status, body } = await unlist();
    expect(status).toBe(200);
    expect(updates).toEqual([{ visibility: "private", submitted_to_trending_at: null }]);
    expect(body.visibility).toBe("private");
  });
});
