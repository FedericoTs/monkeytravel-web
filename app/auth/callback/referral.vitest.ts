import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Referral credit at the auth callback.
 *
 * A fresh Google/Apple account never reached the only attach on the OAuth
 * path: it sits in the isNewUser block, which cannot run because
 * handle_new_user creates public.users first. Until 2026-09-25 no Google
 * signup was credited to the friend whose link brought them. The credit now
 * happens on the account's FIRST arrival, on both paths, and never for a
 * returning login, whose link may carry a code from a trip it looked at.
 * Supabase is mocked; the route runs for real.
 */

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const rpc = vi.fn<(fn: string, params?: unknown) => Promise<unknown>>(async () => ({ data: [{ attributed: true }], error: null }));
let profile: Record<string, unknown>;

function usersTable() {
  const chain = {
    select: () => chain,
    update: () => chain,
    eq: () => chain,
    single: async () => ({ data: profile, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp, exchangeCodeForSession },
    from: () => usersTable(),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, delete: () => {} }),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});
vi.mock("@/lib/analytics/wizard-event-server", () => ({ logWizardStepServer: vi.fn() }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: vi.fn() }));

import { GET } from "./route";

const APP = "https://monkeytravel.app";
const fresh = { id: "u-new", created_at: new Date(Date.now() - 60_000).toISOString() };
const returning = { id: "u-old", created_at: "2025-01-01T00:00:00Z" };

async function callback(query: string, user: { id: string; created_at: string }, loginCount: number) {
  profile = { id: user.id, onboarding_completed: false, welcome_completed: false, login_count: loginCount, profile_completed: true };
  verifyOtp.mockResolvedValue({ data: { user }, error: null });
  exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
  const res = await GET(new Request(`${APP}/auth/callback?${query}`));
  expect(res.status).toBeGreaterThanOrEqual(300);
  return res;
}

const attaches = () => rpc.mock.calls.filter(([fn]) => fn === "attach_referral_on_signup");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Google / Apple (code exchange)", () => {
  it("credits the friend when the account is new", async () => {
    await callback("code=c&next=%2Ftrips%2Fnew&locale=en&ref=FRIEND1", fresh, 0);
    expect(attaches()).toEqual([["attach_referral_on_signup", { p_user_id: "u-new", p_code: "FRIEND1" }]]);
  });

  it("never credits anyone for a returning login", async () => {
    await callback("code=c&next=%2Ftrips&locale=en&ref=FRIEND1", returning, 12);
    expect(attaches()).toEqual([]);
  });
});

describe("emailed links (token_hash)", () => {
  it("credits the friend on the first confirmation", async () => {
    await callback("token_hash=h&type=signup&locale=en&next=%2Ftrips%2Fnew&ref=FRIEND2", fresh, 0);
    expect(attaches()).toEqual([["attach_referral_on_signup", { p_user_id: "u-new", p_code: "FRIEND2" }]]);
  });

  it("a returning user's magic link carrying a code credits nobody", async () => {
    await callback("token_hash=h&type=magiclink&locale=en&next=%2Ftrips&ref=FRIEND2", returning, 7);
    expect(attaches()).toEqual([]);
  });
});

it("no code, no attach", async () => {
  await callback("code=c&next=%2Ftrips%2Fnew&locale=en", fresh, 0);
  await callback("token_hash=h&type=signup&locale=en&next=%2Ftrips%2Fnew", fresh, 0);
  expect(attaches()).toEqual([]);
});
