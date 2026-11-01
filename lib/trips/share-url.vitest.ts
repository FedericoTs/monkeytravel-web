/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A shared link carries the owner's referral code when it can be had, and is
 * a plain link otherwise: sharing never fails over attribution, but a code
 * that couldn't be resolved is logged.
 */

let rpcResult: { data: unknown; error: unknown };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => rpcResult }) }));

beforeEach(() => {
  rpcResult = { data: "ANA123", error: null };
});

describe("buildShareUrl", () => {
  it("carries the owner's referral code", async () => {
    const { buildShareUrl } = await import("./share-url");
    expect(await buildShareUrl("owner-1", "tok-1")).toMatch(/\/shared\/tok-1\?ref=ANA123$/);
  });

  it("is a plain link, and says why, when the code can't be resolved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResult = { data: null, error: { message: "timeout" } };
    const { buildShareUrl } = await import("./share-url");
    expect(await buildShareUrl("owner-1", "tok-1")).toMatch(/\/shared\/tok-1$/);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("referral-code resolve failed"), expect.anything());
  });
});
