/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Anyone who has seen a trip can make every open Today screen refresh, and
 * anyone with the link can call these reads directly. Screens refresh at most
 * every few seconds; past a generous limit per visitor a read is turned away
 * before the trip is even looked up.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
let browserCookie: string | undefined;
let readsAllowed = true;
const checks: Array<{ namespace: string; key: string | undefined }> = [];
let log: FakeQuery[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined) }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (namespace: string) => ({
    check: async (_request: unknown, key?: string) => {
      checks.push({ namespace, key });
      return { allowed: readsAllowed };
    },
  }),
}));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  signedInUserId: async () => null,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/today/snapshot", () => ({ todayActionsSnapshot: async () => [] }));
vi.mock("@/lib/expenses/snapshot", () => ({ expensesSnapshot: async () => ({ expenses: [], summary: null }) }));
vi.mock("@/lib/feed/snapshot", () => ({ feedSnapshot: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase(() => ({ data: { id: "trip-1", user_id: "owner-1", itinerary: [] }, error: null }));
    log = fake.log;
    return fake.client;
  },
}));

const reads = {
  "today-actions": (await import("./today-actions/route")).GET,
  feed: (await import("./feed/route")).GET,
  expenses: (await import("./expenses/route")).GET,
};
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const read = (name: keyof typeof reads) => reads[name](new NextRequest(`http://localhost/api/shared/${TOKEN}/${name}`), ctx);

beforeEach(() => {
  browserCookie = "browser-cookie-1";
  readsAllowed = true;
  checks.length = 0;
  log = [];
});

describe("Today's shared reads", () => {
  it.each(["today-actions", "feed", "expenses"] as const)("%s turns a visitor away past the limit, before looking up the trip", async (name) => {
    readsAllowed = false;
    const res = await read(name);
    expect(res.status).toBe(429);
    expect(log).toEqual([]);
  });

  it("counts a visitor by this browser and the link", async () => {
    expect((await read("today-actions")).status).toBe(200);
    expect(checks).toEqual([{ namespace: "today-read", key: `browser-cookie-1:${TOKEN}` }]);
  });

  it("counts a visitor without a cookie by their address", async () => {
    browserCookie = undefined;
    await read("feed");
    expect(checks).toEqual([{ namespace: "today-read", key: undefined }]);
  });
});
