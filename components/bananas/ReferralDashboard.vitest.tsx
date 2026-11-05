/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import ReferralDashboard from "./ReferralDashboard";
import type { BananasDashboardResponse } from "@/types/bananas";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./BananaBalance", () => ({ default: () => null }));
vi.mock("./TierProgress", () => ({ default: () => null }));
vi.mock("./TierBadge", () => ({ default: () => null }));

const dashboard = {
  balance: { available: 3 },
  tier: {},
  badges: [],
  recentTransactions: [],
  referralStats: { totalReferrals: 47, pendingReferrals: 13, bananasEarned: 29 },
} as unknown as BananasDashboardResponse;

const send = vi.fn<(url: string) => Promise<Response>>();

beforeEach(() => {
  send.mockReset();
  vi.stubGlobal("fetch", send);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the referral dashboard", () => {
  it("shows what it was given, and asks for nothing", () => {
    render(<ReferralDashboard initialData={dashboard} />);
    expect(screen.getByText("47")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("reads it otherwise, and shows it", async () => {
    send.mockImplementation(async () => new Response(JSON.stringify(dashboard), { status: 200 }));
    const { container } = render(<ReferralDashboard />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/bananas");
    await screen.findByText("47");
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("says so when it can't be read", async () => {
    send.mockImplementation(async () => new Response("{}", { status: 500 }));
    const { container } = render(<ReferralDashboard />);
    await screen.findByText("Failed to fetch dashboard data");
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("has words of its own for a failure without a message", async () => {
    send.mockImplementation(async () => {
      throw "offline";
    });
    render(<ReferralDashboard />);
    await waitFor(() => expect(screen.getByText("An error occurred")).toBeTruthy());
  });
});
