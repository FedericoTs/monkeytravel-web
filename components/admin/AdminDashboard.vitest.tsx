import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { adminStatsFixture } from "@/tests/admin-stats-fixture";
import AdminDashboard from "./AdminDashboard";

vi.mock("@/lib/lazy", () => ({
  LazyUserGrowthChart: () => <div>growth chart</div>,
  LazyTrafficOverview: () => <div>traffic overview</div>,
  LazyAcquisitionEngagement: () => <div>acquisition</div>,
  LazyCostCommandCenter: () => <div>costs tab</div>,
  LazyAccessControl: () => <div>access tab</div>,
  LazyApiControlPanel: () => <div>apis tab</div>,
  LazyPromptEditor: () => <div>prompts tab</div>,
  LazyAccessCodesManager: () => <div>codes tab</div>,
  LazyGrowthDashboard: () => <div>growth tab</div>,
  preloadAdminTab: () => {},
}));
vi.mock("@/components/admin/ActivationFunnelPanel", () => ({ default: () => <div>activation funnel</div> }));

let statsAnswer: () => Response;
const fetchMock = vi.fn(async (url: string) =>
  String(url).includes("ux10x")
    ? new Response(
        JSON.stringify({
          generatedAt: "2026-11-05T12:00:00.000Z",
          window7d: { lo: "2026-10-29", hi: "2026-11-05" },
          rates: { step1To2Pct: 37.4, weeklyActiveCrews: 3 },
          last7d: { anonStep1Sessions: 400, saves: 30, tripsCreated: 45, tripsShared: 12, aiConversations: 20 },
          daily: [{ day: "2026-11-05", anonStep1Sessions: 70, saves: 6, tripsCreated: 7, tripsShared: 3, aiConversations: 4 }],
          frozenBaseline: { label: "base", anonStep1PerDayMedian: 36, step1To2Pct: 43.2, savesPerDay: 1.3, shareCreationPct: 10, aiConversationsPerDay: 2, weeklyActiveCrews: 1 },
        }),
        { status: 200 }
      )
    : statsAnswer()
);

const press = async (name: RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};
/** The card a heading belongs to. */
const card = (heading: string) => screen.getByText(heading).closest("section, div.rounded-2xl, div.rounded-xl") as HTMLElement;

beforeEach(() => {
  statsAnswer = () => new Response(JSON.stringify(adminStatsFixture), { status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Analytics tab", () => {
  it("reads nothing until asked, since each read costs", () => {
    render(<AdminDashboard />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows every card once loaded", async () => {
    render(<AdminDashboard />);
    await press(/refresh/i);
    for (const heading of [
      "Total Users",
      "Total Trips",
      "AI Requests",
      "Page Views",
      "Activation",
      "AI Spend",
      "Visitor Analytics",
      "Top Destinations",
      "Email Subscribers",
      "Weekly Cohort Retention",
      "Recent Activity",
    ]) {
      expect(screen.getAllByText(heading).length, heading).toBeGreaterThan(0);
    }
    for (const lazy of ["growth chart", "traffic overview", "acquisition"]) {
      expect(screen.getByText(lazy), lazy).toBeTruthy();
    }
    expect(screen.queryByText("activation funnel")).toBeNull();
  });

  it("shows the activation funnel when there is one", async () => {
    statsAnswer = () => new Response(JSON.stringify({ ...adminStatsFixture, activationFunnel: {} }), { status: 200 });
    render(<AdminDashboard />);
    await press(/refresh/i);
    expect(screen.getByText("activation funnel")).toBeTruthy();
  });

  it("says so when the read fails, and tries again on request", async () => {
    statsAnswer = () => new Response("{}", { status: 500 });
    render(<AdminDashboard />);
    await press(/refresh/i);
    expect(screen.queryByText("Total Users")).toBeNull();

    statsAnswer = () => new Response(JSON.stringify(adminStatsFixture), { status: 200 });
    await press(/retry|try again/i);
    expect(screen.getByText("Total Users")).toBeTruthy();
  });

  it("puts minutes on a short time to the first trip, and a short name on a model", async () => {
    render(<AdminDashboard />);
    await press(/refresh/i);
    expect(screen.getByText("24m")).toBeTruthy();
    expect(screen.getByText("2.5 flash")).toBeTruthy();
    expect(screen.getByText("2.5 pro")).toBeTruthy();
  });

  it("shows the visitors by pages, countries or cities", async () => {
    render(<AdminDashboard />);
    await press(/refresh/i);
    const visitors = card("Visitor Analytics");
    expect(within(visitors).getAllByText("/trips/new").length).toBeGreaterThan(0);
    expect(within(visitors).getAllByText(/Italy/).length).toBeGreaterThan(0);
    expect(within(visitors).getByText("Rome")).toBeTruthy();
  });

  it("leaves out of the cohort table the weeks a cohort hasn't reached", async () => {
    render(<AdminDashboard />);
    await press(/refresh/i);
    expect(screen.getByText("41%")).toBeTruthy();
    expect(screen.getByText("Oct 12")).toBeTruthy();
  });

  it("says how long ago each thing happened", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T12:00:00.000Z"), toFake: ["Date"] });
    render(<AdminDashboard />);
    await press(/refresh/i);
    expect(screen.getByText("2m ago")).toBeTruthy();
    expect(screen.getByText("2h ago")).toBeTruthy();
    expect(screen.getByText("1d ago")).toBeTruthy();
    vi.useRealTimers();
  });

  it("loads the North Star card on its own click", async () => {
    render(<AdminDashboard />);
    await press(/^load$/i);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/admin/ux10x-baseline"]);
    expect(screen.getByText("37.4%")).toBeTruthy();
  });
});

describe("the tabs", () => {
  it.each([
    [/^growth$/i, "growth tab"],
    [/^costs$/i, "costs tab"],
    [/^apis$/i, "apis tab"],
    [/^prompts$/i, "prompts tab"],
    [/^access$/i, "access tab"],
    [/^codes$/i, "codes tab"],
  ])("%s opens its own", async (tab, content) => {
    render(<AdminDashboard />);
    await press(tab);
    expect(screen.getByText(content)).toBeTruthy();
    expect(screen.queryByText("UX10X North Star")).toBeNull();
  });
});
