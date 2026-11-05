import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computeGrowthStats } from "@/lib/admin/growth/stats";
import type { GrowthRows } from "@/lib/admin/growth/rows";
import type { GrowthStats } from "@/lib/admin/growth/types";
import GrowthDashboard from "./GrowthDashboard";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const rows: GrowthRows = {
  users: [
    { id: "a", display_name: "Ana", created_at: daysAgo(40), last_sign_in_at: null, onboarding_completed: true, subscription_tier: "free", is_pro: false, referred_by_code: null, banana_balance: 20, referral_tier: 1, show_on_leaderboard: true, leaderboard_visibility: "full" },
    { id: "b", display_name: "Bo", created_at: daysAgo(40), last_sign_in_at: null, onboarding_completed: false, subscription_tier: "free", is_pro: false, referred_by_code: "X", banana_balance: 0, referral_tier: 0, show_on_leaderboard: true, leaderboard_visibility: "full" },
  ],
  trips: [{ id: "t", user_id: "a", created_at: daysAgo(35), share_token: "tok", is_template: false }],
  referralCodes: [{ id: "c", user_id: "a", total_clicks: 4, total_signups: 1 }],
  aiConversations: [],
  collaborators: [{ id: "k", trip_id: "t", user_id: "b", role: "editor", invited_by: "a" }],
  invites: [{ id: "i", trip_id: "t", created_by: "a", use_count: 1 }],
  proposals: [{ id: "p", proposed_by: "a", status: "approved", resolution_method: "consensus" }],
  proposalVotes: [{ id: "v", proposal_id: "p", user_id: "b", vote_type: "approve" }],
  bananaTransactions: [{ id: "n", user_id: "a", amount: 20, transaction_type: "referral", created_at: daysAgo(2), expires_at: null, expired: false }],
  referralTiers: [],
  redemptionCatalog: [],
  bananaRedemptions: [],
  anonVotes: [{ id: "x", voter_cookie_id: "cookie", trip_id: "t" }],
};
const stats = computeGrowthStats(rows, [], NOW);

let answer: () => Response;
const fetchMock = vi.fn(async () => answer());
const respondWith = (body: GrowthStats) => {
  answer = () => new Response(JSON.stringify(body), { status: 200 });
};
const open = async () => {
  render(<GrowthDashboard />);
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  respondWith(stats);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Growth tab", () => {
  it("loads on opening, and shows every section", async () => {
    await open();
    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["/api/admin/growth"]);
    for (const heading of [
      "D1 Retention",
      "D7 Retention",
      "D30 Retention",
      "AARRR Funnel (Pirate Metrics)",
      "User Lifecycle Stages",
      "Sharing & Virality",
      "K-Factor",
      "📈 Virality Playbook",
    ]) {
      expect(screen.getByText(heading), heading).toBeTruthy();
    }
  });

  it("names the champions", async () => {
    await open();
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("says retention is a proxy until sign-ins are tracked", async () => {
    await open();
    expect(screen.getAllByText(/Activity-based/).length).toBeGreaterThan(0);
    cleanup();
    respondWith({ ...stats, meta: { ...stats.meta, retentionMethod: "sign_in", signInTrackingAvailable: true } });
    await open();
    expect(screen.queryByText(/Activity-based/)).toBeNull();
  });

  it("names a read that failed", async () => {
    respondWith({ ...stats, meta: { ...stats.meta, dataWarnings: ["trips: read failed"] } });
    await open();
    expect(screen.getByText(/trips: read failed/)).toBeTruthy();
  });

  it("says so when the numbers can't be loaded, and tries again on request", async () => {
    answer = () => new Response("{}", { status: 500 });
    await open();
    expect(screen.getByText(/Failed to fetch growth stats/)).toBeTruthy();

    respondWith(stats);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(screen.getByText("D7 Retention")).toBeTruthy();
    expect(screen.queryByText(/Failed to fetch growth stats/)).toBeNull();
  });
});
