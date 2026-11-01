/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A referral pays the referrer at the rate of their referral tier. The tier
 * sits on the referrer's users row, which the referee's own client cannot
 * read (users_select_own), so it is read with the service role.
 */

const REFEREE = "referee-1";
const REFERRER = "referrer-1";

const addReferralBananas = vi.fn(async () => ({ success: true, newBalance: 10 }));
vi.mock("@/lib/bananas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bananas")>()),
  addReferralBananas,
  checkAndUnlockTier: async () => ({ tierUnlocked: false, tierInfo: { currentTier: 2 }, bonusBananas: 0 }),
}));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => undefined }));

let tierRead: { data: unknown; error: unknown };
let admin: ReturnType<typeof fakeSupabase>;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

const isTierRead = (q: FakeQuery) => q.table === "users" && q.op === "select" && eqOf(q, "id") === REFERRER;

/** The referee's own client: their row only, as RLS allows. */
const referee = () =>
  fakeSupabase((q) => {
    if (q.table === "users" && eqOf(q, "id") === REFEREE) {
      return { data: { referred_by_code: "CODE1", referral_completed_at: null }, error: null };
    }
    if (q.table === "users") {
      return q.end === "single" ? { data: null, error: { code: "PGRST116", message: "no rows" } } : { data: null, error: null };
    }
    return { data: null, error: null };
  }).client as unknown as SupabaseClient;

beforeEach(() => {
  addReferralBananas.mockClear();
  tierRead = { data: { referral_tier: 2 }, error: null };
  admin = fakeSupabase((q) => {
    if (q.table === "referral_codes") return { data: { id: "code-1", user_id: REFERRER, total_conversions: 2 }, error: null };
    if (q.table === "users" && q.op === "update") return { data: [{ id: eqOf(q, "id") }], error: null };
    if (isTierRead(q)) return tierRead;
    if (q.table === "referral_events") return { data: { id: "event-1" }, error: null };
    if (q.table === "increment_referral_conversions") return { data: 3, error: null };
    return { data: null, error: null };
  });
});

describe("the referrer's reward", () => {
  it("is paid at the referrer's tier", async () => {
    const { completeReferralIfEligible } = await import("./completion");
    const result = await completeReferralIfEligible(referee(), REFEREE, "trip-1");
    expect(result).toMatchObject({ success: true, referrerRewarded: true });
    expect(addReferralBananas).toHaveBeenCalledWith(expect.anything(), REFERRER, "event-1", 2);
  });

  it("is paid at the base rate, with the failure logged, when the tier can't be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    tierRead = { data: null, error: { message: "canceling statement due to statement timeout" } };
    const { completeReferralIfEligible } = await import("./completion");
    await completeReferralIfEligible(referee(), REFEREE, "trip-1");
    expect(addReferralBananas).toHaveBeenCalledWith(expect.anything(), REFERRER, "event-1", 0);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("referral tier"), expect.anything());
  });
});
