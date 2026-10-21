// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Deleting an account needs a second proof that it is really the account's
 * owner: the six-digit code emailed by /api/profile/delete/code, or the
 * password. Google sign-ins have no password, so before the code existed they
 * could not delete their account at all.
 */

const USER = { id: "user-1", email: "traveler@example.com" };

const rpc = vi.fn(async () => ({ error: null }));
const deleteUser = vi.fn(async () => ({ error: null }));
const signInWithPassword = vi.fn(async () => ({ error: null as { message: string } | null }));
const verifyDeletionCode = vi.fn(async () => ({ ok: true }) as { ok: boolean; kind?: string });
let allowed = true;

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: USER, errorResponse: null }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, auth: { admin: { deleteUser } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword } }),
}));
vi.mock("@/lib/auth/deletion-code", () => ({
  verifyDeletionCode: (...args: unknown[]) => verifyDeletionCode(...(args as [])),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed, remaining: allowed ? 1 : 0 }) }),
}));

async function post(body: unknown, site = "same-origin") {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/profile/delete", {
      method: "POST",
      headers: { "sec-fetch-site": site, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  allowed = true;
  verifyDeletionCode.mockResolvedValue({ ok: true });
  signInWithPassword.mockResolvedValue({ error: null });
});

describe("POST /api/profile/delete", () => {
  it("deletes the account with a correct emailed code", async () => {
    const { status } = await post({ code: "482915" });
    expect(status).toBe(200);
    expect(verifyDeletionCode).toHaveBeenCalledWith(USER.email, USER.id, "482915");
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("delete_user_account", { p_user_id: USER.id });
    expect(deleteUser).toHaveBeenCalledWith(USER.id);
  });

  it("deletes nothing when the code is wrong or expired", async () => {
    verifyDeletionCode.mockResolvedValue({ ok: false, kind: "expired" });
    const { status, json } = await post({ code: "000000" });
    expect(status).toBe(401);
    expect(json.code).toBe("CODE_INVALID");
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("says when the code could not be checked, rather than calling it wrong", async () => {
    verifyDeletionCode.mockResolvedValue({ ok: false, kind: "network" });
    const { status, json } = await post({ code: "482915" });
    expect(status).toBe(503);
    expect(json.code).toBe("CODE_UNCHECKED");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still accepts the password", async () => {
    const { status } = await post({ password: "correct horse" });
    expect(status).toBe(200);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: USER.email, password: "correct horse" });
    expect(deleteUser).toHaveBeenCalledWith(USER.id);
  });

  it("still accepts the body the previous dialog sent", async () => {
    const { status } = await post({ confirmationText: "delete my account", password: "correct horse" });
    expect(status).toBe(200);
  });

  it("deletes nothing with a wrong password", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { status, json } = await post({ password: "wrong" });
    expect(status).toBe(401);
    expect(json.code).toBe("PASSWORD_INCORRECT");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for a code or a password", async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(json.code).toBe("CONFIRMATION_REQUIRED");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops repeated guesses", async () => {
    allowed = false;
    const { status } = await post({ code: "482915" });
    expect(status).toBe(429);
    expect(verifyDeletionCode).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    const { status } = await post({ code: "482915" }, "cross-site");
    expect(status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
