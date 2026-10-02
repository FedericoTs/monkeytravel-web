/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * After signing in, what this browser did as a guest, on every trip, becomes
 * the account's. It takes both the session and the browser's own guest cookie.
 */

let signedIn: { id: string } | null = null;
let browserCookie: string | undefined;
let rpcFails = false;
let log: FakeQuery[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browserCookie ? { value: browserCookie } : undefined) }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true }) }) }));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () =>
    signedIn
      ? { user: signedIn, errorResponse: null }
      : { user: null, errorResponse: NextResponse.json({ error: "Sign in required" }, { status: 401 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase(() => (rpcFails ? { data: null, error: { message: "boom" } } : { data: 1, error: null }));
    log = fake.log;
    return fake.client;
  },
}));

const { POST } = await import("./route");
const call = () => POST(new NextRequest("http://localhost/api/participants/link", { method: "POST" }));

beforeEach(() => {
  signedIn = { id: "user-1" };
  browserCookie = "guest-cookie-1";
  rpcFails = false;
  log = [];
});

describe("POST /api/participants/link", () => {
  it("hands this browser's guest activity on every trip to the account", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ linked: true });
    expect(log.map((q) => [q.table, q.op, q.value])).toEqual([
      ["link_guest_to_account", "rpc", { p_user_id: "user-1", p_cookie: "guest-cookie-1", p_trip_id: null }],
    ]);
  });

  it("has nothing to hand over without a guest cookie", async () => {
    browserCookie = undefined;
    const res = await call();
    expect(await res.json()).toMatchObject({ linked: false });
    expect(log).toEqual([]);
  });

  it("needs a signed-in account", async () => {
    signedIn = null;
    expect((await call()).status).toBe(401);
    expect(log).toEqual([]);
  });

  it("reports a failed link, so the browser tries again at the next sign-in", async () => {
    rpcFails = true;
    expect((await call()).status).toBe(500);
  });
});
