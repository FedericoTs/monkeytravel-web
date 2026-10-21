import { describe, it, expect, vi } from "vitest";
import { verifyDeletionCode, type VerifyCode } from "./deletion-code";

/**
 * The emailed code is how an account without a password (every Google
 * sign-in) confirms its own deletion. It must only ever confirm the signed-in
 * user, and a wrong or expired code must stop there.
 */

const EMAIL = "traveler@example.com";
const USER = "user-1";

function verifier(outcomes: Record<string, { userId?: string; message?: string; status?: number }>) {
  return vi.fn<VerifyCode>(async ({ type }) => {
    const o = outcomes[type] ?? { message: "Token has expired or is invalid", status: 403 };
    return o.message
      ? { userId: null, error: { message: o.message, status: o.status } }
      : { userId: o.userId ?? null, error: null };
  });
}

describe("verifyDeletionCode", () => {
  it("confirms the signed-in user with one request", async () => {
    const verify = verifier({ email: { userId: USER } });
    await expect(verifyDeletionCode(EMAIL, USER, "482915", verify)).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith({ email: EMAIL, token: "482915", type: "email" });
  });

  it("accepts the code pasted with spaces or text around it", async () => {
    const verify = verifier({ email: { userId: USER } });
    await expect(verifyDeletionCode(EMAIL, USER, "Your code: 482 915", verify)).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ token: "482915" }));
  });

  it("rejects an incomplete code without asking Supabase", async () => {
    const verify = verifier({});
    await expect(verifyDeletionCode(EMAIL, USER, "4829", verify)).resolves.toEqual({ ok: false, kind: "invalid" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("never confirms an account other than the signed-in one", async () => {
    const verify = verifier({ email: { userId: "someone-else" } });
    await expect(verifyDeletionCode(EMAIL, USER, "482915", verify)).resolves.toEqual({ ok: false, kind: "invalid" });
  });

  it("stops at a wrong or expired code", async () => {
    // GoTrue answers both with the same sentence.
    const verify = verifier({});
    const result = await verifyDeletionCode(EMAIL, USER, "000000", verify);
    expect(result.ok).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("tries the next type only when the code was rejected as invalid", async () => {
    const verify = verifier({
      email: { message: "Invalid token", status: 403 },
      signup: { message: "Invalid token", status: 403 },
      magiclink: { userId: USER },
    });
    await expect(verifyDeletionCode(EMAIL, USER, "482915", verify)).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("reports an outage as such, not as a wrong code", async () => {
    const verify = verifier({ email: { message: "Gateway Timeout", status: 504 } });
    await expect(verifyDeletionCode(EMAIL, USER, "482915", verify)).resolves.toEqual({ ok: false, kind: "network" });
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
