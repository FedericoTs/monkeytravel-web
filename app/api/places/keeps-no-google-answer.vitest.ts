/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Google's terms let us keep only place IDs and, for 30 days, coordinates. The
 * place search and the destination cover answer from Google every time: they
 * neither read a stored answer nor store the new one.
 */

process.env.GOOGLE_PLACES_API_KEY = "test-key";

const tables: string[] = [];
const db = {
  from: (table: string) => {
    tables.push(table);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "update", "upsert"]) chain[m] = () => chain;
    chain.single = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return chain;
  },
};
vi.mock("@/lib/supabase/cache-admin", () => ({ cacheAdminDb: () => db }));
vi.mock("@/lib/images/destination-photos", () => ({ destinationPhotos: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true, shouldPassKey: true }),
  logApiCall: vi.fn(async () => {}),
  ApiBlockedError: class extends Error {},
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  incrementUsage: vi.fn(async () => {}),
}));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "u1", email: "traveller@example.com" }, errorResponse: null }),
}));

const GOOGLE_PLACE = {
  id: "ChIJexample",
  displayName: { text: "Example Harbour" },
  formattedAddress: "1 Quay Street, Example Town",
  location: { latitude: 10, longitude: 20 },
  photos: [{ name: "places/ChIJexample/photos/abc", widthPx: 800, heightPx: 600, authorAttributions: [] }],
};

const { GET, POST } = await import("./route");
const fetchSpy = vi.fn();

beforeEach(() => {
  tables.length = 0;
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ places: [GOOGLE_PLACE] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});

describe("Google's answers are shown, never kept", () => {
  it("the destination cover asks Google and keeps nothing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/places?destination=Example%20Town"));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Example Harbour");
    expect(fetchSpy).toHaveBeenCalled();
    expect(tables).not.toContain("google_places_cache");
  });

  it("the place search asks Google and keeps nothing", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/places", {
        method: "POST",
        body: JSON.stringify({ query: "Example Harbour" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    expect(tables).not.toContain("google_places_cache");
  });
});
