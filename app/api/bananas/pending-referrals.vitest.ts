import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The referral numbers on the bananas dashboard.
 *
 * "Pending" was a count on referral_events by referrer_id and status, two
 * columns that do not exist, so every GET /api/bananas logged a 42703 and the
 * dashboard showed 0 pending forever. It now comes from the code's counters.
 */

const tables: string[] = [];
let codeRow: Record<string, number> | null = null;

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "u1" },
    errorResponse: null,
    supabase: {
      from: (table: string) => {
        tables.push(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: codeRow, error: null }),
          single: async () => ({ data: codeRow, error: codeRow ? null : { code: "PGRST116" } }),
        };
        return chain;
      },
    },
  }),
}));
vi.mock("@/lib/bananas", () => ({
  getBananaBalance: async () => ({ available: 0 }),
  getReferralTierInfo: async () => ({}),
  getTierBadges: async () => [],
  getTransactionHistory: async () => [],
  getReferralBananasEarned: async () => 0,
}));

import { GET } from "./route";

async function referralStats() {
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.data ?? body).referralStats;
}

beforeEach(() => {
  tables.length = 0;
  codeRow = null;
});

describe("GET /api/bananas referral stats", () => {
  it("counts signed-up-not-yet-converted as pending", async () => {
    codeRow = { total_signups: 5, total_conversions: 2 };
    expect(await referralStats()).toMatchObject({ totalReferrals: 2, pendingReferrals: 3 });
  });

  it("never goes negative", async () => {
    // RYNEJ2 in production: 1 signup, 1 conversion.
    codeRow = { total_signups: 1, total_conversions: 1 };
    expect(await referralStats()).toMatchObject({ totalReferrals: 1, pendingReferrals: 0 });
    codeRow = { total_signups: 0, total_conversions: 1 };
    expect((await referralStats()).pendingReferrals).toBe(0);
  });

  it("answers zeros for an account with no referral code", async () => {
    expect(await referralStats()).toMatchObject({ totalReferrals: 0, pendingReferrals: 0 });
  });

  it("no longer queries referral_events", async () => {
    codeRow = { total_signups: 1, total_conversions: 0 };
    await referralStats();
    expect(tables).not.toContain("referral_events");
    const src = readFileSync(join(process.cwd(), "app/api/bananas/route.ts"), "utf8");
    expect(src).not.toMatch(/\.eq\(\s*['"]referrer_id['"]/);
  });
});

describe("profile page beta access", () => {
  it("reads redeemed_at, a column user_tester_access actually has", () => {
    const src = readFileSync(join(process.cwd(), "app/[locale]/profile/page.tsx"), "utf8");
    const select = src.match(/from\("user_tester_access"\)\s*\.select\("([^"]*)"\)/)?.[1];
    expect(select).toBe("code_used, redeemed_at");
    expect(src).toMatch(/activatedAt: betaAccess\.redeemed_at/);
  });
});
