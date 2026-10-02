/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A signed-in person's chip tap is stored under their account, so it reads as
 * theirs and they can undo it from any device. A guest's stays with their
 * browser.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
let signedIn: { id: string; email?: string } | null = null;
let browserCookie: string | undefined;
let collaborators: string[] = [];
let existingAction: { actor_user_id: string | null; actor_cookie_id: string | null } | null = null;
let log: FakeQuery[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined), set: () => {} }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: () => {} }));
vi.mock("@/lib/ai/nearby-alternative", () => ({ suggestNearbyAlternative: async () => null }));
vi.mock("@/lib/today/snapshot", () => ({ todayActionsSnapshot: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips") return { data: { id: "trip-1", user_id: "owner-1", trip_meta: {} }, error: null };
      if (q.table === "trip_collaborators") {
        const id = eqOf(q, "user_id") as string;
        return { data: collaborators.includes(id) ? { user_id: id } : null, error: null };
      }
      if (q.table === "users") return { data: { display_name: "Luca" }, error: null };
      if (q.table === "trip_participants") return { data: eqOf(q, "participant_cookie_id") ? { display_name: "Bo" } : null, error: null };
      if (q.table === "trip_today_actions" && q.op === "select") return { data: existingAction, error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));

const { POST } = await import("./route");
const tap = (body: Record<string, unknown>) =>
  POST(
    new NextRequest(`http://localhost/api/shared/${TOKEN}/today-action`, {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
const writes = (op: FakeQuery["op"]) => log.filter((q) => q.table === "trip_today_actions" && q.op === op);

beforeEach(() => {
  signedIn = null;
  browserCookie = "browser-cookie-1";
  collaborators = [];
  existingAction = null;
});

describe("POST /api/shared/[token]/today-action", () => {
  it("stores a collaborator's tap under their account and profile name", async () => {
    signedIn = { id: "mate-1" };
    collaborators = ["mate-1"];
    const res = await tap({ action_type: "running_late", day_number: 1 });
    expect(res.status).toBe(200);
    expect(writes("insert")[0].value).toMatchObject({
      actor_user_id: "mate-1",
      actor_cookie_id: null,
      actor_name: "Luca",
      actor_role: "participant",
    });
  });

  it("keeps a guest's tap with their browser", async () => {
    browserCookie = "guest-cookie-1";
    await tap({ action_type: "running_late", day_number: 1 });
    expect(writes("insert")[0].value).toMatchObject({ actor_user_id: null, actor_cookie_id: "guest-cookie-1", actor_name: "Bo" });
  });

  it("undoes your tap from another device of the same account", async () => {
    signedIn = { id: "mate-1" };
    browserCookie = "second-browser-1";
    existingAction = { actor_user_id: "mate-1", actor_cookie_id: "first-browser-1" };
    const actionId = "22222222-3333-4444-8555-666666666666";
    await tap({ undo: true, action_id: actionId });
    const [undo] = writes("update");
    expect(undo?.value).toMatchObject({ undone_at: expect.any(String) });
    expect(eqOf(undo, "id")).toBe(actionId);
    // Not limited to this browser's cookie, which wrote nothing here.
    expect(eqOf(undo, "actor_cookie_id")).toBeUndefined();
  });

  it("leaves someone else's tap alone", async () => {
    signedIn = { id: "mate-1" };
    existingAction = { actor_user_id: "other-1", actor_cookie_id: "other-browser-1" };
    const res = await tap({ undo: true, action_id: "22222222-3333-4444-8555-666666666666" });
    expect(res.status).toBe(200);
    expect(writes("update")).toEqual([]);
  });
});
