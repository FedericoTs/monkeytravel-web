// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * A body that isn't JSON is the client's mistake: the trip routes answer it
 * with a 400 (readJsonBody), not with their catch-all's 500.
 */

const TRIP = "11111111-1111-4111-8111-111111111111";

const db = () =>
  fakeSupabase((q) => {
    if (q.table === "trips") return { data: { id: TRIP, user_id: "user-1", title: "Lisbon", status: "planning" }, error: null };
    if (q.table === "trip_checklists") return { data: { id: "item-1", trip_id: TRIP, user_id: "user-1" }, error: null };
    return { data: null, error: null };
  }).client;

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () => ({ user: { id: "user-1", email: "user@example.com" }, supabase: db(), errorResponse: null }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));

const malformed = (method: string) =>
  new NextRequest(`http://localhost/api/trips/${TRIP}`, { method, body: "{not json", headers: { "content-type": "application/json" } });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

const handlers: Array<[string, () => Promise<Response>]> = [
  ["editing an activity", async () => (await import("./activities/[activityId]/route")).PATCH(malformed("PATCH"), ctx({ id: TRIP, activityId: "act-1" }))],
  ["voting on an activity", async () => (await import("./activities/[activityId]/vote/route")).POST(malformed("POST"), ctx({ id: TRIP, activityId: "act-1" }))],
  ["adding a checklist item", async () => (await import("./checklist/route")).POST(malformed("POST"), ctx({ id: TRIP }))],
  ["editing a checklist item", async () => (await import("./checklist/[itemId]/route")).PATCH(malformed("PATCH"), ctx({ id: TRIP, itemId: "item-1" }))],
  ["changing a role", async () => (await import("./collaborators/[userId]/route")).PATCH(malformed("PATCH"), ctx({ id: TRIP, userId: "mate-1" }))],
  ["creating an invite", async () => (await import("./invites/route")).POST(malformed("POST"), ctx({ id: TRIP }))],
  ["proposing an activity", async () => (await import("./proposals/route")).POST(malformed("POST"), ctx({ id: TRIP }))],
  ["resolving a proposal", async () => (await import("./proposals/[proposalId]/route")).PATCH(malformed("PATCH"), ctx({ id: TRIP, proposalId: "prop-1" }))],
  ["voting on a proposal", async () => (await import("./proposals/[proposalId]/vote/route")).POST(malformed("POST"), ctx({ id: TRIP, proposalId: "prop-1" }))],
  ["changing the status", async () => (await import("./status/route")).PATCH(malformed("PATCH"), ctx({ id: TRIP }))],
  ["caching travel times", async () => (await import("./travel-cache/route")).POST(malformed("POST"), ctx({ id: TRIP }))],
  ["duplicating a trip", async () => (await import("../duplicate/route")).POST(malformed("POST"))],
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a body that isn't JSON", () => {
  it.each(handlers)("is a 400 when %s", async (_, call) => {
    const res = await call();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid JSON body" });
  });
});
