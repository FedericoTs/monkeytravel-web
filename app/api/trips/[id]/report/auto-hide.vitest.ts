import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Enough reports hide a trip from Explore, and its public card turns into the
 * brand card. The CDN keeps serving the old card for a day unless it's dropped.
 */

const purgeTripCard = vi.fn<(tripId: string) => Promise<void>>(async () => undefined);
const tripUpdates: unknown[] = [];
let countAfterReport = 5;

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void task(),
}));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => undefined }));
vi.mock("@/lib/seo/trip-card-cache", () => ({ purgeTripCard }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: "trip-1", visibility: "public", is_hidden: false } }) }),
      }),
    }),
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      update: (value: unknown) => ({ eq: async () => (tripUpdates.push(value), { error: null }) }),
    }),
    rpc: async () => ({ data: countAfterReport, error: null }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { POST } = await import("./route");
const report = () =>
  POST(
    new NextRequest("http://localhost/api/trips/trip-1/report", {
      method: "POST",
      body: JSON.stringify({ reason: "spam" }),
    }),
    { params: Promise.resolve({ id: "trip-1" }) },
  );

beforeEach(() => {
  purgeTripCard.mockClear();
  tripUpdates.length = 0;
});

describe("POST /api/trips/[id]/report", () => {
  it("drops the cached card when a report hides the trip", async () => {
    countAfterReport = 5;
    const res = await report();
    expect(res.status).toBe(200);
    expect(tripUpdates).toEqual([{ is_hidden: true }]);
    expect(purgeTripCard).toHaveBeenCalledWith("trip-1");
  });

  it("leaves the card alone while the trip stays up", async () => {
    countAfterReport = 4;
    const res = await report();
    expect(res.status).toBe(200);
    expect(tripUpdates).toEqual([]);
    expect(purgeTripCard).not.toHaveBeenCalled();
  });
});
