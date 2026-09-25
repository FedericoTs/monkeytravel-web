// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/referral/attach credits a NEW account only.
 *
 * The RPC allows one attribution per account but never looked at its age, so
 * any signed-in account that was never referred could credit itself to a code
 * (30 bananas plus a signup on the code) whenever it liked. Its callers (the
 * signup page's instant session, the wizard's typed sign-in code) all run
 * right after the account is created.
 */

const rpc = vi.fn(async () => ({ data: [{ attributed: true, referrer_id: "friend" }], error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
let user: { id: string; created_at?: string } | null;
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () =>
    user ? { user, supabase: {}, errorResponse: null } : { user: null, supabase: {}, errorResponse: new Response(null, { status: 401 }) },
}));

async function attach(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST(new Request("http://localhost/api/referral/attach", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeEach(() => {
  rpc.mockClear();
});

describe("referral attach", () => {
  it("credits the friend for an account made minutes ago", async () => {
    user = { id: "u-new", created_at: new Date(Date.now() - 5 * 60_000).toISOString() };
    const { json } = await attach({ code: "FRIEND1" });
    expect(rpc).toHaveBeenCalledWith("attach_referral_on_signup", { p_user_id: "u-new", p_code: "FRIEND1" });
    expect(json.attributed).toBe(true);
  });

  it("an older account cannot credit itself to a code", async () => {
    user = { id: "u-old", created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() };
    const { json } = await attach({ code: "FRIEND1" });
    expect(rpc).not.toHaveBeenCalled();
    expect(json.attributed).toBe(false);
  });

  it("an account with no creation time is not treated as new", async () => {
    user = { id: "u-odd" };
    await attach({ code: "FRIEND1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("signed out is 401; a missing code attributes nothing", async () => {
    user = null;
    expect((await attach({ code: "FRIEND1" })).status).toBe(401);
    user = { id: "u-new", created_at: new Date().toISOString() };
    expect((await attach({})).json.attributed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
