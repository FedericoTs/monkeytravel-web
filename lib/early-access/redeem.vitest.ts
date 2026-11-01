/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * One early-access code per account. "Already redeemed" comes from reading the
 * account's access row, so a read the database refused stops the redemption
 * instead of reading as "no code yet" and inserting a second row.
 */

let accessRead: { data: unknown; error: unknown };
const inserts: unknown[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase(() => accessRead).client,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q) => {
      if (q.op === "insert") inserts.push(q.value);
      if (q.table === "tester_codes") return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: null, error: null };
    }).client,
}));

beforeEach(() => {
  inserts.length = 0;
  accessRead = { data: null, error: { code: "PGRST116", message: "no rows" } };
});

describe("redeemTesterCode", () => {
  it("refuses a second code", async () => {
    accessRead = { data: { code_used: "FIRST1" }, error: null };
    const { redeemTesterCode } = await import("./index");
    expect(await redeemTesterCode("user-1", "second2")).toEqual({ success: false, error: "You've already redeemed a code: FIRST1" });
  });

  it("checks the code when the account has none yet", async () => {
    const { redeemTesterCode } = await import("./index");
    expect(await redeemTesterCode("user-1", "nope")).toEqual({ success: false, error: "Invalid code. Please check and try again." });
  });

  it("redeems nothing when the account's access can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    accessRead = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const { redeemTesterCode } = await import("./index");
    expect(await redeemTesterCode("user-1", "valid1")).toEqual({ success: false, error: "Failed to redeem code. Please try again." });
    expect(inserts).toEqual([]);
  });
});
