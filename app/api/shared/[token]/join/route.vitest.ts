/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Signed in, a person has one "I'm going" row per trip, their account's, on
 * any browser. What this browser did here as a guest becomes theirs first;
 * a guest is still found by their browser.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
let signedIn: { id: string; email?: string } | null = null;
let browserCookie: string | undefined;
/** The row found for this person, by account or by browser. */
let ownRow: Record<string, unknown> | null = null;
/** Whether this browser's cookie already keys a row on the trip. */
let cookieTaken = false;
let log: FakeQuery[] = [];
const setCookie = vi.fn();
/** The plan emails asked for, what the send reports, and whether the limits allow one. */
const planSends: unknown[] = [];
let planStatus = "sent";
let planAllowed = true;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined), set: setCookie }),
}));
vi.mock("nanoid", () => ({ nanoid: () => "fresh-browser-id-0001" }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: () => {} }));
vi.mock("@/lib/participants/plan-email", () => ({
  mayEmailPlan: async () => planAllowed,
  sendParticipantPlanEmail: async (_admin: unknown, args: unknown) => {
    planSends.push(args);
    return planStatus;
  },
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips") return { data: { id: "trip-1", user_id: "owner-1", title: "Lisbon" }, error: null };
      if (q.table === "trip_participants" && q.op === "insert") return { data: { id: "new-row-1" }, error: null };
      if (q.table === "trip_participants" && q.op === "select" && q.end === "maybeSingle") {
        const isTakenCheck = eqOf(q, "participant_cookie_id") !== undefined && signedIn !== null;
        if (isTakenCheck) return { data: cookieTaken ? { id: "someone-elses-row" } : null, error: null };
        return { data: ownRow, error: null };
      }
      if (q.table === "trip_participants" && q.end === "list") return { data: [], error: null };
      return { data: null, error: null };
    });
    log = fake.log;
    return fake.client;
  },
}));

const { POST } = await import("./route");
const send = (body: Record<string, unknown>) =>
  POST(
    new NextRequest(`http://localhost/api/shared/${TOKEN}/join`, {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );
const ops = (table: string, op: FakeQuery["op"]) => log.filter((q) => q.table === table && q.op === op);
const ownLookup = () => log.find((q) => q.table === "trip_participants" && q.end === "maybeSingle");

beforeEach(() => {
  signedIn = null;
  browserCookie = "browser-cookie-1";
  ownRow = null;
  cookieTaken = false;
  setCookie.mockClear();
  planSends.length = 0;
  planStatus = "sent";
  planAllowed = true;
});

describe("POST /api/shared/[token]/join", () => {
  it("makes this browser's guest row the account's, then works on the account's row", async () => {
    signedIn = { id: "user-1" };
    ownRow = { id: "row-1", left_at: null, display_name: "Bo", email: null };
    const res = await send({ action: "update", display_name: "Bo B" });
    expect(res.status).toBe(200);
    const [link] = ops("link_guest_to_account", "rpc");
    expect(link.value).toEqual({ p_user_id: "user-1", p_cookie: "browser-cookie-1", p_trip_id: "trip-1" });
    const lookup = ownLookup()!;
    expect(log.indexOf(link)).toBeLessThan(log.indexOf(lookup));
    expect(eqOf(lookup, "user_id")).toBe("user-1");
    expect(eqOf(lookup, "participant_cookie_id")).toBeUndefined();
    const [update] = ops("trip_participants", "update");
    expect(eqOf(update, "id")).toBe("row-1");
    expect(update.value).toEqual({ display_name: "Bo B" });
  });

  it("joins under a fresh id when this browser's cookie already keys another account's row", async () => {
    signedIn = { id: "user-1" };
    cookieTaken = true;
    await send({ action: "join" });
    expect(ops("trip_participants", "insert")[0].value).toMatchObject({
      participant_cookie_id: "fresh-browser-id-0001",
      user_id: "user-1",
    });
  });

  it("joins under this browser's cookie when nobody else holds it", async () => {
    signedIn = { id: "user-1" };
    await send({ action: "join" });
    expect(ops("trip_participants", "insert")[0].value).toMatchObject({
      participant_cookie_id: "browser-cookie-1",
      user_id: "user-1",
    });
  });

  it("finds a guest by this browser and links nothing", async () => {
    ownRow = { id: "row-2", left_at: "2026-10-01T10:00:00Z", display_name: "Bo", email: null };
    await send({ action: "join" });
    expect(eqOf(ownLookup()!, "participant_cookie_id")).toBe("browser-cookie-1");
    expect(ops("link_guest_to_account", "rpc")).toEqual([]);
    const [rejoin] = ops("trip_participants", "update");
    expect(rejoin.value).toEqual({ left_at: null });
  });

  it("confirms someone who said they're going on the public page when they join through the share link, and only then", async () => {
    ownRow = { id: "row-3", left_at: null, display_name: "Pat", email: null, source: "public" };
    await send({ action: "join", source: "shared" });
    const [confirmed] = ops("trip_participants", "update");
    expect(eqOf(confirmed, "id")).toBe("row-3");
    expect(confirmed.value).toEqual({ left_at: null, source: "shared" });

    // The group ask is the share link too, and so is coming back after leaving.
    ownRow = { id: "row-3", left_at: "2026-10-01T10:00:00Z", display_name: "Pat", email: null, source: "public" };
    await send({ action: "join", source: "crew_ask" });
    expect(ops("trip_participants", "update")[0].value).toEqual({ left_at: null, source: "shared" });

    // A tab of the public page opened before it went read-only still sends "public".
    ownRow = { id: "row-3", left_at: null, display_name: "Pat", email: null, source: "public" };
    await send({ action: "join", source: "public" });
    expect(ops("trip_participants", "update")[0].value).toEqual({ left_at: null });
    // A name change isn't joining.
    await send({ action: "update", display_name: "Pat B" });
    expect(ops("trip_participants", "update")[0].value).toEqual({ display_name: "Pat B" });
  });

  it("has nothing to link on a browser that had no cookie", async () => {
    signedIn = { id: "user-1" };
    browserCookie = undefined;
    await send({ action: "join" });
    expect(ops("link_guest_to_account", "rpc")).toEqual([]);
    expect(setCookie).toHaveBeenCalledTimes(1);
  });
  it("lets the owner say they're going on their own trip", async () => {
    signedIn = { id: "owner-1" };
    await send({ action: "join" });
    expect(ops("trip_participants", "insert")).toHaveLength(1);
  });
});

describe("the plan by email", () => {
  it("emails the plan to an address typed on joining, in the page's language, and says it went", async () => {
    const res = await send({ action: "join", email: " Ana@Example.com ", locale: "it" });
    expect(planSends).toEqual([
      { tripId: "trip-1", shareToken: TOKEN, participantId: "new-row-1", email: "ana@example.com", locale: "it" },
    ]);
    expect((await res.json()).plan_email).toBe("sent");
  });

  it("emails it to an address typed after saying they're going", async () => {
    ownRow = { id: "row-1", left_at: null, display_name: "Bo", email: null, source: "shared" };
    await send({ action: "update", email: "bo@example.com" });
    expect(planSends).toEqual([expect.objectContaining({ participantId: "row-1", email: "bo@example.com", locale: null })]);
  });

  it("never emails an address nobody typed, or someone leaving", async () => {
    signedIn = { id: "user-1", email: "acct@example.com" };
    const res = await send({ action: "join" });
    expect(ops("trip_participants", "insert")[0].value).toMatchObject({ email: "acct@example.com" });
    expect(await res.json()).not.toHaveProperty("plan_email");
    ownRow = { id: "row-1", left_at: null, display_name: null, email: "acct@example.com", source: "shared" };
    await send({ action: "leave", email: "other@example.com" });
    expect(planSends).toEqual([]);
  });

  it("never emails the share link to a row from the public page", async () => {
    await send({ action: "join", source: "public", email: "pat@example.com" });
    ownRow = { id: "row-3", left_at: null, display_name: "Pat", email: null, source: "public" };
    await send({ action: "update", email: "pat@example.com" });
    await send({ action: "join", source: "public", email: "pat@example.com" });
    expect(planSends).toEqual([]);
    // Joining through the share link confirms them, and then it goes.
    await send({ action: "join", source: "shared", email: "pat@example.com" });
    expect(planSends).toEqual([expect.objectContaining({ participantId: "row-3" })]);
  });

  it("says when the plan went before, and when it could not go", async () => {
    planStatus = "skipped_duplicate";
    expect((await (await send({ action: "join", email: "ana@example.com" })).json()).plan_email).toBe("already");
    planStatus = "skipped_suppressed";
    expect((await (await send({ action: "join", email: "ana@example.com" })).json()).plan_email).toBe("not_sent");
    planAllowed = false;
    planSends.length = 0;
    expect((await (await send({ action: "join", email: "ana@example.com" })).json()).plan_email).toBe("not_sent");
    expect(planSends).toEqual([]);
  });
});
