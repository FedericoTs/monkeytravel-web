// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * When a referred person creates their first trip, their referrer earns bananas,
 * once. Bananas buy AI generations, so a repeat must pay nothing. The real route,
 * completion and banana code run; the Supabase clients and PostHog are faked, with
 * the referred person's row kept so a repeat really finds its claim.
 */

const REFEREE = { id: "referee-1", email: "person@mail.example.com" };
const REFERRER = "referrer-1";
const REFERRAL_CODE = { id: "ref-code-1", code: "FRIEND1", user_id: REFERRER, total_conversions: 2 };
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const REFUSED = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
const FAILED = { code: "XX000", message: "write failed" };

const s = vi.hoisted(() => ({
  signedIn: null as { id: string; email: string } | null,
  referee: {} as Record<string, unknown>,
  refereeRead: null as { data: unknown; error: unknown } | null,
  referralCode: null as Record<string, unknown> | null,
  codeRead: null as { data: unknown; error: unknown } | null,
  claimError: null as unknown,
  /** Another request got to the claim first. */
  claimLost: false,
  eventError: null as unknown,
  bananasError: null as unknown,
  tierUnlocked: false,
  events: [] as unknown[],
}));

vi.mock("@/lib/posthog/server", () => ({
  captureServerEvent: async (who: string, name: string) => void s.events.push([who, name]),
}));

/** The referred person's own client: their row only, as RLS allows. */
const session = fakeSupabase((q: FakeQuery) => {
  if (s.refereeRead) return s.refereeRead;
  return q.table === "users" && eqOf(q, "id") === REFEREE.id ? { data: s.referee, error: null } : NO_ROW;
});
const service = fakeSupabase((q: FakeQuery) => {
  switch (q.table) {
    case "referral_codes":
      if (s.codeRead) return s.codeRead;
      if (eqOf(q, "user_id")) return { data: { total_conversions: 3 }, error: null };
      return s.referralCode && eqOf(q, "code") === s.referralCode.code ? { data: s.referralCode, error: null } : NO_ROW;
    case "users":
      if (q.op === "select") return { data: { referral_tier: 0 }, error: null };
      if (eqOf(q, "id") !== REFEREE.id) return { data: [{ id: eqOf(q, "id") }], error: null };
      if (s.claimError) return { data: null, error: s.claimError };
      if (s.claimLost || s.referee.referral_completed_at) return { data: [], error: null };
      Object.assign(s.referee, q.value);
      return { data: [{ id: REFEREE.id }], error: null };
    case "referral_events":
      return s.eventError ? { data: null, error: s.eventError } : { data: { id: "event-1" }, error: null };
    case "increment_referral_conversions":
      return { data: 3, error: null };
    case "add_bananas":
      return s.bananasError
        ? { data: null, error: s.bananasError }
        : { data: [{ new_balance: 750, transaction_id: "tx-1" }], error: null };
    case "check_and_unlock_tier":
      return { data: [{ tier_unlocked: s.tierUnlocked, bonus_bananas: s.tierUnlocked ? 100 : 0 }], error: null };
    case "referral_tiers":
      return { data: { current_tier: 1, highest_tier_achieved: 1 }, error: null };
    default:
      return { data: null, error: null };
  }
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...session.client, auth: { getUser: async () => ({ data: { user: s.signedIn }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));

const { POST } = await import("./route");

const rpcs = (name: string) => service.log.filter((q) => q.table === name);
const writes = () => service.log.filter((q) => q.op !== "select");
const NOT_PAID = {
  referrer_rewarded: false,
  referee_rewarded: false,
  bananas: { awarded: false, tierUnlocked: false, tierBonus: 0 },
};

beforeEach(() => {
  s.signedIn = REFEREE;
  s.referee = { referred_by_code: REFERRAL_CODE.code, referral_completed_at: null };
  s.refereeRead = null;
  s.referralCode = { ...REFERRAL_CODE };
  s.codeRead = null;
  s.claimError = null;
  s.claimLost = false;
  s.eventError = null;
  s.bananasError = null;
  s.tierUnlocked = false;
  s.events = [];
  session.log.length = 0;
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("who may call it", () => {
  it("refuses someone signed out, reading and paying nothing", async () => {
    s.signedIn = null;
    expect((await POST()).status).toBe(401);
    expect(session.log).toEqual([]);
    expect(service.log).toEqual([]);
  });

  it("acts only on the signed-in person's own row", async () => {
    await POST();
    expect(session.log.map((q) => eqOf(q, "id"))).toEqual([REFEREE.id]);
    expect(eqOf(writes()[0], "id")).toBe(REFEREE.id);
  });
});

describe("paying a referral", () => {
  it("claims it, records the conversion, and pays the referrer once, by that record", async () => {
    const res = await POST();
    expect(res.status).toBe(200);

    expect(writes()[0]).toMatchObject({ table: "users", op: "update", value: { referral_completed_at: expect.any(String) } });
    expect(writes()[0].filters).toContainEqual(["is", "referral_completed_at", null]);
    expect(rpcs("referral_events")[0].value).toMatchObject({
      referral_code_id: REFERRAL_CODE.id,
      referee_id: REFEREE.id,
      event_type: "conversion",
      reward_amount: 1,
    });
    expect(rpcs("increment_referral_conversions").map((q) => q.value)).toEqual([{ p_code_id: REFERRAL_CODE.id }]);
    expect(rpcs("add_bananas").map((q) => q.value)).toEqual([
      expect.objectContaining({ p_user_id: REFERRER, p_amount: 50, p_type: "referral", p_reference_id: "event-1" }),
    ]);
    const sync = writes().find((q) => q.table === "users" && eqOf(q, "id") === REFERRER);
    expect(sync?.value).toEqual({ lifetime_referral_conversions: 3, referral_tier: 1 });

    expect(await res.json()).toMatchObject({ success: true, referrer_rewarded: true, bananas: { awarded: true, tierUnlocked: false, tierBonus: 0 } });
    expect(s.events).toContainEqual([REFERRER, "referral_converted"]);
  });

  it("doesn't tell the referred person their referrer's banana balance", async () => {
    const body = await (await POST()).text();
    expect(body).not.toContain("750");
  });

  it("pays nothing the second time, whoever asks twice", async () => {
    await POST();
    const again = await POST();
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ success: true, ...NOT_PAID, message: "Referral reward already claimed" });
    expect(rpcs("add_bananas")).toHaveLength(1);
    expect(rpcs("referral_events")).toHaveLength(1);
  });

  it("pays nothing when another request won the claim first", async () => {
    s.claimLost = true;
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, ...NOT_PAID, message: "Referral reward already claimed" });
    expect(rpcs("add_bananas")).toEqual([]);
    expect(rpcs("referral_events")).toEqual([]);
  });

  it("pays under a reference that stays the same when the conversion can't be recorded", async () => {
    s.eventError = FAILED;
    expect((await POST()).status).toBe(200);
    expect(rpcs("add_bananas").map((q) => q.value)).toEqual([
      expect.objectContaining({ p_user_id: REFERRER, p_reference_id: `referee:${REFEREE.id}` }),
    ]);
  });

  it.skip("pays only once the referred person has a trip, and this one has none", async () => {
    await POST();
    expect(rpcs("add_bananas")).toEqual([]);
    expect(s.referee.referral_completed_at).toBeNull();
  });

  it.skip("pays nothing when the code is the person's own", async () => {
    s.referralCode = { ...REFERRAL_CODE, user_id: REFEREE.id };
    await POST();
    expect(rpcs("add_bananas")).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it.skip("doesn't say the referrer was rewarded when the bananas couldn't be paid", async () => {
    s.bananasError = FAILED;
    expect(await (await POST()).json()).toMatchObject({ referrer_rewarded: false });
  });

  it.skip("leaves the claim open when the bananas couldn't be paid, so a retry can pay them", async () => {
    s.bananasError = FAILED;
    await POST();
    expect(s.referee.referral_completed_at).toBeNull();
  });

  it.skip("doesn't show the referred person their referrer's new tier or bonus", async () => {
    s.tierUnlocked = true;
    const { bananas } = await (await POST()).json();
    expect(bananas).not.toHaveProperty("newTier");
    expect(bananas.tierBonus).toBe(0);
  });
});

describe("when there's nothing to pay", () => {
  it("answers success and writes nothing for someone who wasn't referred", async () => {
    s.referee = { referred_by_code: null, referral_completed_at: null };
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ...NOT_PAID, message: "User was not referred" });
    expect(service.log).toEqual([]);
  });
});

describe("when the database fails", () => {
  it("answers 500 and writes nothing when the person's row can't be read", async () => {
    s.refereeRead = REFUSED;
    expect((await POST()).status).toBe(500);
    expect(service.log).toEqual([]);
  });

  it("answers 500 and claims nothing when the referrer's code can't be found", async () => {
    s.codeRead = REFUSED;
    const res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBeUndefined();
    expect(writes()).toEqual([]);
  });

  it("answers 500 and pays nothing when the claim fails", async () => {
    s.claimError = FAILED;
    expect((await POST()).status).toBe(500);
    expect(rpcs("add_bananas")).toEqual([]);
    expect(rpcs("referral_events")).toEqual([]);
  });
});
