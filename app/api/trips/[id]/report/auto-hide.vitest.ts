import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Enough reports hide a trip from Explore, and its public card turns into the
 * brand card. The CDN keeps serving the old card for a day unless it's dropped.
 */

const purgeTripCard = vi.fn<(tripId: string) => Promise<void>>(async () => undefined);
const tripUpdates: unknown[] = [];
let countAfterReport = 5;
let hideError: unknown = null;
let reportInserts = 0;
let recentFromIp: { count: number | null; error: unknown } = { count: 0, error: null };

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
      select: () => ({ eq: () => ({ gte: async () => recentFromIp }) }),
      insert: async () => (reportInserts++, { error: null }),
      update: (value: unknown) => ({ eq: async () => (tripUpdates.push(value), { error: hideError }) }),
    }),
    rpc: async () => ({ data: countAfterReport, error: null }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { POST } = await import("./route");
const report = (headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/trips/trip-1/report", {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "spam" }),
    }),
    { params: Promise.resolve({ id: "trip-1" }) },
  );

beforeEach(() => {
  purgeTripCard.mockClear();
  tripUpdates.length = 0;
  hideError = null;
  reportInserts = 0;
  recentFromIp = { count: 0, error: null };
});

describe("the per-IP report limit", () => {
  it("records a report while the IP is under the limit", async () => {
    countAfterReport = 1;
    const res = await report({ "x-forwarded-for": "203.0.113.7" });
    expect(res.status).toBe(200);
    expect(reportInserts).toBe(1);
  });

  it("records nothing when the IP's count can't be read", async () => {
    recentFromIp = { count: null, error: { message: "canceling statement due to statement timeout" } };
    const res = await report({ "x-forwarded-for": "203.0.113.7" });
    expect(res.status).toBe(500);
    expect(reportInserts).toBe(0);
  });
});

describe("POST /api/trips/[id]/report", () => {
  it("drops the cached card when a report hides the trip", async () => {
    countAfterReport = 5;
    const res = await report();
    expect(res.status).toBe(200);
    expect(tripUpdates).toEqual([{ is_hidden: true }]);
    expect(purgeTripCard).toHaveBeenCalledWith("trip-1");
  });

  it("says the trip wasn't hidden when the write fails, and keeps its card", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    countAfterReport = 5;
    hideError = { message: "boom" };
    const res = await report();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reported: true, autoHidden: false });
    expect(purgeTripCard).not.toHaveBeenCalled();
  });

  it("leaves the card alone while the trip stays up", async () => {
    countAfterReport = 4;
    const res = await report();
    expect(res.status).toBe(200);
    expect(tripUpdates).toEqual([]);
    expect(purgeTripCard).not.toHaveBeenCalled();
  });
});
