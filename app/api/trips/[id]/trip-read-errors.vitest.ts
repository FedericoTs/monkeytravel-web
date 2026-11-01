// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * The trip routes check access through verifyTripAccess / verifyTripOwnership,
 * so a trip read the database refused answers 500, and only a trip that isn't
 * there answers 404. Each handler below read the trip itself and took a
 * refused read for "not found" or "not allowed".
 */

const TRIP = "11111111-1111-4111-8111-111111111111";
const PARTICIPANT = "22222222-2222-4222-8222-222222222222";
let tripRead: { data: unknown; error: unknown };
/** A table whose selects the database refuses. */
let refusing: string | null;
const inserted: string[] = [];

const db = () =>
  fakeSupabase((q) => {
    if (q.op === "insert") inserted.push(q.table);
    if (q.op === "select" && q.table === refusing) return { data: null, error: { code: "57014", message: "timeout" } };
    if (q.table === "trips") return tripRead;
    if (q.table === "activity_proposals") {
      return { data: { id: "prop-1", trip_id: TRIP, proposed_by: "user-1", status: "voting", target_day: 1, activity_data: {} }, error: null };
    }
    return { data: null, error: null };
  }).client;

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () => ({ user: { id: "user-1", email: "user@example.com" }, supabase: db(), errorResponse: null }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));

const req = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/trips/${TRIP}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

const handlers: Array<[string, () => Promise<Response>]> = [
  ["voting on an activity", async () => (await import("./activities/[activityId]/vote/route")).POST(req("POST", { voteType: "love" }), ctx({ id: TRIP, activityId: "act-1" }))],
  ["voting on a proposal", async () => (await import("./proposals/[proposalId]/vote/route")).POST(req("POST", { voteType: "love" }), ctx({ id: TRIP, proposalId: "prop-1" }))],
  [
    "proposing an activity",
    async () => (await import("./proposals/route")).POST(req("POST", { type: "new", activityData: { name: "Rooftop bar" }, targetDay: 1 }), ctx({ id: TRIP })),
  ],
  ["resolving a proposal", async () => (await import("./proposals/[proposalId]/route")).PATCH(req("PATCH", { action: "approve" }), ctx({ id: TRIP, proposalId: "prop-1" }))],
  ["changing a role", async () => (await import("./collaborators/[userId]/route")).PATCH(req("PATCH", { role: "voter" }), ctx({ id: TRIP, userId: "mate-1" }))],
  ["removing a member", async () => (await import("./collaborators/[userId]/route")).DELETE(req("DELETE"), ctx({ id: TRIP, userId: "mate-1" }))],
  ["listing who's going", async () => (await import("./participants/route")).GET(req("GET"), ctx({ id: TRIP }))],
  ["removing a participant", async () => (await import("./participants/[participantId]/route")).DELETE(req("DELETE"), ctx({ id: TRIP, participantId: PARTICIPANT }))],
  ["unpublishing", async () => (await import("./publish/route")).DELETE(req("DELETE"), ctx({ id: TRIP }))],
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  refusing = null;
  inserted.length = 0;
});

describe("an earlier vote that can't be read", () => {
  it.each([
    ["activity_votes", handlers[0][1]],
    ["proposal_votes", handlers[1][1]],
  ] as const)("adds no second vote to %s", async (table, call) => {
    tripRead = { data: { id: TRIP, user_id: "user-1" }, error: null };
    refusing = table;
    expect((await call()).status).toBe(500);
    expect(inserted).not.toContain(table);
  });
});

describe("a trip read the database refused", () => {
  it.each(handlers)("is a 500 when %s", async (_, call) => {
    tripRead = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    expect((await call()).status).toBe(500);
  });
});

describe("a trip that isn't there", () => {
  it.each(handlers)("is a 404 when %s", async (_, call) => {
    tripRead = { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    expect((await call()).status).toBe(404);
  });
});
