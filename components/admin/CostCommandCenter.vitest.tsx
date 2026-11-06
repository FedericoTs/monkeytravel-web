import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CostCommandCenter from "./CostCommandCenter";

const analytics = {
  summary: {
    totalCostUsd: 580.75,
    todayCostUsd: 1.5,
    last7DaysCostUsd: 64.03,
    last30DaysCostUsd: 284.34,
    totalRequests: 90_264,
    todayRequests: 120,
    avgCostPerRequest: 0.0064,
    projectedMonthlyCost: 77.48,
    lastMonthCostUsd: 128.16,
  },
  performance: { avgResponseTimeMs: 100, p50ResponseTimeMs: 90, p95ResponseTimeMs: 300, p99ResponseTimeMs: 900, errorRate: 1, totalErrors: 5, successRate: 99 },
  cache: {
    hitRate: 10,
    totalHits: 5,
    totalMisses: 45,
    estimatedSavingsUsd: 0.05,
    byType: {
      geocode: { entries: 0, hits: 0 },
      distance: { entries: 0, hits: 0 },
      places: { entries: 0, hits: 0 },
      activities: { entries: 0, hits: 0 },
    },
  },
  circuitBreakers: [],
  byApi: [],
  byUser: [],
  dailyTrend: [],
  hourlyTrend: [],
  topEndpoints: [],
  recentActivity: [],
  generatedAt: "2026-11-05T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Costs tab", () => {
  it("says its numbers are list prices from the logs, not the bill", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(analytics), { status: 200 })));
    render(<CostCommandCenter />);
    fireEvent.click(screen.getByRole("button", { name: /load/i }));

    const note = (await screen.findByTestId("costs-list-price-note")).textContent;
    expect(note).toContain("list price");
    expect(note).toContain("free allowances");
    expect(note).toContain("Billing");
    expect(screen.getByText("Total logged")).toBeTruthy();
    expect(screen.queryByText("Total Spent")).toBeNull();
    expect(screen.getByText("$580.75")).toBeTruthy();
    expect(note).toContain("Vercel");
  });

  it("gives the month's estimate as after the free calls, next to last month's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(analytics), { status: 200 })));
    render(<CostCommandCenter />);
    fireEvent.click(screen.getByRole("button", { name: /load/i }));

    expect(await screen.findByText("This month, estimated")).toBeTruthy();
    expect(screen.getByText("$77.48")).toBeTruthy();
    expect(screen.getByText("after free calls · last month $128.16")).toBeTruthy();
    expect(screen.queryByText("Projected /mo")).toBeNull();
  });
});
