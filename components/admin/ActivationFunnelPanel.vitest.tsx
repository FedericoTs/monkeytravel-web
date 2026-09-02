/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ActivationFunnelPanel from "./ActivationFunnelPanel";
import { buildFunnelWindow, loopFromRpc, type ActivationFunnelStats } from "@/lib/admin/activation-funnel";

// The production numbers on 2026-09-02, the day this shipped. If the panel
// can say these correctly it can say any.
const GOOGLE = { provider: "google", signups: 99, confirmed: 99, reached_wizard: 98, generated: 82, has_trip: 79, generated_no_trip: 3, save_failed_users: 0 };
const EMAIL = { provider: "email", signups: 47, confirmed: 37, reached_wizard: 28, generated: 23, has_trip: 20, generated_no_trip: 3, save_failed_users: 0 };
const LOOP = { anon_created: 55, anon_visited: 33, share_visits: 72, plan_own_clicks: 0, claimed: 0, claimed_any: 0, unclaimed_live: 55, expired: 0 };

function stats(overrides: Partial<ActivationFunnelStats> = {}): ActivationFunnelStats {
  return {
    available: true,
    computedAt: "2026-09-02T12:00:00.000Z",
    last7d: buildFunnelWindow({ days: 7, from: "a", to: "b" }, [{ ...GOOGLE, signups: 30, has_trip: 24 }, { ...EMAIL, signups: 10, has_trip: 4 }]),
    last30d: buildFunnelWindow({ days: 30, from: "a", to: "b" }, [GOOGLE, EMAIL]),
    prior30d: buildFunnelWindow({ days: 30, from: "z", to: "a" }, [{ ...GOOGLE, signups: 80, has_trip: 50 }]),
    anonymousLoop: { last30d: loopFromRpc(30, LOOP), prior30d: loopFromRpc(30, { ...LOOP, anon_created: 0 }) },
    ...overrides,
  };
}

describe("ActivationFunnelPanel", () => {
  it("shows the four cohort steps with totals across providers and the rate of signups", () => {
    render(<ActivationFunnelPanel funnel={stats()} />);
    const panel = screen.getByText("What the last 30 days of signups actually did").closest("[data-activation-funnel]")!;
    // The provider table repeats the step labels as column headers; the steps come first in DOM order.
    expect(within(panel as HTMLElement).getAllByText("Signed up")[0].nextElementSibling?.textContent).toBe("146");
    expect(within(panel as HTMLElement).getAllByText("Confirmed")[0].nextElementSibling?.textContent).toBe("136");
    expect(within(panel as HTMLElement).getAllByText("Generated an itinerary")[0].nextElementSibling?.textContent).toBe("105");
    expect(within(panel as HTMLElement).getAllByText("Has a trip")[0].nextElementSibling?.textContent).toBe("99");
    // 99 / 146 = 67.8%, and prior 50 / 80 = 62.5% → +5.3 pts
    expect(screen.getByText(/67\.8% of signups · \+5\.3 pts vs prior 30d/)).toBeTruthy();
    expect(screen.getByText("Google 99 · Email 47")).toBeTruthy();
    expect(screen.getByText("Last 7 days: 40 signed up, 28 with a trip")).toBeTruthy();
  });

  it("names the lost bucket, failed saves and unconfirmed email signups", () => {
    render(<ActivationFunnelPanel funnel={stats()} />);
    expect(screen.getByText("Generated, no trip").previousElementSibling?.textContent).toBe("6");
    expect(screen.getByText("Users with a failed save").previousElementSibling?.textContent).toBe("0");
    expect(screen.getByText("Email signups unconfirmed").previousElementSibling?.textContent).toBe("10");
    expect(screen.getByText("Google signup → trip").previousElementSibling?.textContent).toBe("79.8%");
  });

  it("renders one table row per provider, best first", () => {
    render(<ActivationFunnelPanel funnel={stats()} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Google", "Email"]);
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Email", "47", "37", "28", "23", "20", "42.6%"]);
  });

  it("shows the signed-out loop with the claim rate and what is still claimable", () => {
    render(<ActivationFunnelPanel funnel={stats()} />);
    expect(screen.getByText("Shared without an account").nextElementSibling?.textContent).toBe("55");
    expect(screen.getByText("Someone opened it").nextElementSibling?.textContent).toBe("33");
    expect(screen.getByText("72 human visits")).toBeTruthy();
    expect(screen.getByText("Claimed at signup").nextElementSibling?.textContent).toBe("0");
    expect(screen.getByText("0% · 0 sharers signed in later · 55 still claimable")).toBeTruthy();
    expect(screen.getByText("Prior 30 days: 0 shared, 0 claimed")).toBeTruthy();
  });

  it("says so when the RPCs are unavailable instead of drawing zeros", () => {
    render(<ActivationFunnelPanel funnel={stats({ available: false })} />);
    expect(screen.getByText(/The consent-free funnel is unavailable right now/)).toBeTruthy();
    expect(screen.queryAllByText("Signed up")).toEqual([]);
  });

  it("does not divide by zero on an empty window", () => {
    const empty = stats({
      last30d: buildFunnelWindow({ days: 30, from: "a", to: "b" }, []),
      prior30d: buildFunnelWindow({ days: 30, from: "z", to: "a" }, []),
      last7d: buildFunnelWindow({ days: 7, from: "a", to: "b" }, []),
    });
    render(<ActivationFunnelPanel funnel={empty} />);
    expect(screen.getByText("no signups in the window")).toBeTruthy();
    expect(screen.getAllByText(/n\/a of signups/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
