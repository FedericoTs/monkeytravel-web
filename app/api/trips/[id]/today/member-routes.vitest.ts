/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Members use Today from the trip page through these routes, so it works
 * whether or not the trip has a share link. Only the owner and collaborators
 * get in, and they act as their account.
 */

const TRIP = { id: "trip-1", user_id: "owner-1", trip_meta: {}, budget: { currency: "EUR" } };
let signedIn: { id: string } | null = { id: "mate-1" };
let member = true;
let log: FakeQuery[] = [];
const announced: string[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => void task(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: () => {} }));
vi.mock("@/lib/today/snapshot", () => ({ todayActionsSnapshot: async () => [] }));
vi.mock("@/lib/expenses/snapshot", () => ({ expensesSnapshot: async () => ({ expenses: [], summary: null }) }));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () =>
    signedIn
      ? { user: signedIn, supabase: {}, errorResponse: null }
      : { user: null, supabase: {}, errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
  verifyTripAccess: async () =>
    member
      ? { trip: TRIP, isOwner: false, collaboratorRole: "editor", errorResponse: null }
      : { trip: null, isOwner: false, collaboratorRole: null, errorResponse: NextResponse.json({ error: "Access denied" }, { status: 403 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trip_collaborators") return { data: eqOf(q, "user_id") === "mate-1" ? { user_id: "mate-1" } : null, error: null };
      if (q.table === "users") return { data: { display_name: "Luca" }, error: null };
      if (q.table === "trip_participants") return { data: q.end === "list" ? [] : null, error: null };
      if (q.table === "trip_expenses" && q.op === "insert") return { data: { id: "exp-1" }, error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return {
      ...fake.client,
      channel: (topic: string) => ({ httpSend: async () => void announced.push(topic) }),
    };
  },
}));

const tap = (await import("./today-action/route")).POST;
const pay = (await import("./expense/route")).POST;
const actions = (await import("./today-actions/route")).GET;
const ctx = { params: Promise.resolve({ id: "trip-1" }) };
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/trips/trip-1/today/${path}`, { method: "POST", body: JSON.stringify(body) });
const writes = (table: string) => log.filter((q) => q.table === table && q.op === "insert");

beforeEach(() => {
  signedIn = { id: "mate-1" };
  member = true;
  announced.length = 0;
  log = [];
});

describe("Today's member routes", () => {
  it("refuse a signed-out request", async () => {
    signedIn = null;
    expect((await tap(post("today-action", { action_type: "done", day_number: 1 }), ctx)).status).toBe(401);
    expect((await actions(new NextRequest("http://localhost/api/trips/trip-1/today/today-actions"), ctx)).status).toBe(401);
    expect(log).toEqual([]);
  });

  it("refuse someone who isn't the owner or a collaborator", async () => {
    member = false;
    expect((await tap(post("today-action", { action_type: "done", day_number: 1 }), ctx)).status).toBe(403);
    expect((await pay(post("expense", { amount: "10" }), ctx)).status).toBe(403);
    expect(log).toEqual([]);
  });

  it("write a member's tap by account and tell everyone's Today, with no share link", async () => {
    const res = await tap(post("today-action", { action_type: "done", day_number: 1 }), ctx);
    expect(res.status).toBe(200);
    expect(writes("trip_today_actions")[0].value).toMatchObject({
      trip_id: "trip-1",
      actor_user_id: "mate-1",
      actor_cookie_id: null,
      actor_name: "Luca",
    });
    expect(announced).toEqual(["trip-today:trip-1"]);
  });

  it("write a member's payment by account and tell everyone's Today", async () => {
    const res = await pay(post("expense", { amount: "10" }), ctx);
    expect(res.status).toBe(200);
    expect(writes("trip_expenses")[0].value).toMatchObject({
      trip_id: "trip-1",
      created_by: "mate-1",
      created_by_cookie_id: null,
      paid_by_user_id: "mate-1",
      paid_by_cookie_id: null,
      currency: "EUR",
    });
    expect(announced).toEqual(["trip-today:trip-1"]);
  });
});
