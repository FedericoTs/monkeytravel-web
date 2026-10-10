// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Taking a trip off Explore leaves its share link working, so a trip that has
 * one goes back to "shared", not "private". The link gets a new token: the old
 * one was public while the trip was listed, and must not keep opening the
 * trip's group page (joining, votes, expenses) once it is not.
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
// The service-role read; the user-scoped client may not select the token.
vi.mock("@/lib/trips/share-token", () => ({ readShareToken: async () => shareToken }));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: OWNER },
    errorResponse: null,
    supabase: {
      from: () => {
        let cols = "";
        const q = {
          select: (c: string) => ((cols = c), q),
          eq: () => q,
          update: (u: Record<string, unknown>) => (updates.push(u), q),
          single: async () =>
            /share_token|\*/.test(cols)
              ? { data: null, error: { code: "42501", message: "permission denied for table trips" } }
              : { data: { id: "trip-1", user_id: OWNER }, error: null },
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
  it("keeps a trip with a share link shared, under a new token", async () => {
    shareToken = "tok";
    const { status, body } = await unlist();
    expect(status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ visibility: "shared", submitted_to_trending_at: null });
    expect(updates[0].share_token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(updates[0].share_token).not.toBe("tok");
    expect(body.visibility).toBe("shared");
    expect(JSON.stringify(body)).not.toContain(String(updates[0].share_token));
  });

  it("gives every unlisting a token nobody has seen", async () => {
    shareToken = "tok";
    await unlist();
    await unlist();
    expect(updates[0].share_token).not.toBe(updates[1].share_token);
  });

  it("makes a trip without one private, without minting a link", async () => {
    shareToken = null;
    const { status, body } = await unlist();
    expect(status).toBe(200);
    expect(updates).toEqual([{ visibility: "private", submitted_to_trending_at: null }]);
    expect(body.visibility).toBe("private");
  });
});
