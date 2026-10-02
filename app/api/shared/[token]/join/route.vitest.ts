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

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined), set: setCookie }),
}));
vi.mock("nanoid", () => ({ nanoid: () => "fresh-browser-id-0001" }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase((q) => {
      if (q.table === "trips") return { data: { id: "trip-1", user_id: "owner-1" }, error: null };
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

  it("has nothing to link on a browser that had no cookie", async () => {
    signedIn = { id: "user-1" };
    browserCookie = undefined;
    await send({ action: "join" });
    expect(ops("link_guest_to_account", "rpc")).toEqual([]);
    expect(setCookie).toHaveBeenCalledTimes(1);
  });
});
