import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ isRefreshing: false, pullDistance: 0 }),
}));
vi.mock("@/lib/native/haptics", () => ({ hapticLight: vi.fn() }));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/ui/PullToRefreshIndicator", () => ({ PullToRefreshIndicator: () => null }));
vi.mock("@/components/templates/CuratedEscapesClient", () => ({ default: () => null }));
vi.mock("@/components/blog/BlogTipsSection", () => ({ default: () => null }));
vi.mock("@/components/referral/ReferralModal", () => ({ default: () => null }));
vi.mock("@/components/trips/TripActionModal", () => ({ default: () => null }));

import TripsPageClient from "./TripsPageClient";

/**
 * My Trips says where each trip stands by its dates: the section it's under, its
 * pill and the status filter all agree, and a trip's last day still counts as
 * the trip. Nothing stores that a trip is under way or over.
 */

const trip = (title: string, start: string, end: string, status = "planning") => ({
  id: title,
  title,
  start_date: start,
  end_date: end,
  status,
  cover_image_url: `https://images.example/${title}.jpg`,
  created_at: "2026-10-01T10:00:00Z",
  is_archived: false,
});

const TODAY = "2026-11-05";
const TRIPS = [
  trip("Over", "2026-10-01", "2026-10-04"),
  trip("OverConfirmed", "2026-10-10", "2026-10-12", "confirmed"),
  trip("LastDay", "2026-11-02", "2026-11-05"),
  trip("OneDay", "2026-11-05", "2026-11-05", "confirmed"),
  trip("FirstDay", "2026-11-05", "2026-11-08"),
  trip("Soon", "2026-11-06", "2026-11-09"),
  trip("Later", "2026-12-01", "2026-12-04", "confirmed"),
  trip("CalledOff", "2026-10-20", "2026-10-22", "cancelled"),
  trip("CalledOffSoon", "2026-12-20", "2026-12-22", "cancelled"),
];

const page = (serverToday: string | undefined = TODAY) => (
  <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
    <TripsPageClient trips={TRIPS} displayName="Ana" lifetimeConversions={0} serverToday={serverToday} />
  </NextIntlClientProvider>
);

const { happeningNow, upcoming, pastAdventures, memories, active, planning, confirmed, cancelled } = common.trips;

/** The trips under a section's heading, by title. */
function sectionOf(root: ParentNode, heading: string): string[] {
  const title = [...root.querySelectorAll("h2")].find((h) => h.textContent === heading);
  if (!title) return [];
  return [...(title.closest(".mb-8")?.querySelectorAll("img") ?? [])].map((img) => img.getAttribute("alt")!);
}

/** The status pill on a trip's card. */
function pillOf(title: string): string {
  const card = screen.getByRole("img", { name: title }).closest("a")!;
  return within(card).getByText(new RegExp(`^(${[memories, active, planning, confirmed, cancelled].join("|")})$`)).textContent!;
}

const atLocal = (year: number, month: number, day: number, hour: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(year, month - 1, day, hour));
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("My Trips, by the dates", () => {
  it("files each trip by its days: the last day and a one-day trip are still happening now", () => {
    atLocal(2026, 11, 5, 18);
    const { container } = render(page());
    expect(sectionOf(container, happeningNow)).toEqual(expect.arrayContaining(["LastDay", "OneDay", "FirstDay"]));
    expect(sectionOf(container, happeningNow)).toHaveLength(3);
    expect(sectionOf(container, upcoming).sort()).toEqual(["CalledOffSoon", "Later", "Soon"]);
    expect(sectionOf(container, pastAdventures).sort()).toEqual(["CalledOff", "Over", "OverConfirmed"]);
  });

  it("shows that on each card's pill, and keeps what the owner chose for a trip yet to start", () => {
    atLocal(2026, 11, 5, 18);
    render(page());
    expect(pillOf("Over")).toBe(memories);
    expect(pillOf("OverConfirmed")).toBe(memories);
    expect(pillOf("LastDay")).toBe(active);
    expect(pillOf("OneDay")).toBe(active);
    expect(pillOf("Soon")).toBe(planning);
    expect(pillOf("Later")).toBe(confirmed);
    expect(pillOf("CalledOff")).toBe(cancelled);
    expect(pillOf("CalledOffSoon")).toBe(cancelled);
  });

  it.each([
    ["active", ["FirstDay", "LastDay", "OneDay"]],
    ["completed", ["Over", "OverConfirmed"]],
    ["planning", ["Soon"]],
    ["confirmed", ["Later"]],
    ["cancelled", ["CalledOff", "CalledOffSoon"]],
  ])("filters %s by the same status", (status, expected) => {
    atLocal(2026, 11, 5, 18);
    const { container } = render(page());
    const [filter] = screen.getAllByRole("combobox", { name: common.trips.filterByStatus });
    fireEvent.change(filter, { target: { value: status } });
    const titles = TRIPS.map((t) => t.title);
    const shown = [...container.querySelectorAll("img")].map((img) => img.getAttribute("alt")!).filter((alt) => titles.includes(alt)).sort();
    expect(shown).toEqual(expected);
  });

  it("uses the browser's own day once it has loaded", () => {
    // The server's day is already tomorrow; here it's still the trip's last evening.
    atLocal(2026, 11, 5, 23);
    const { container } = render(page("2026-11-06"));
    expect(sectionOf(container, happeningNow)).toContain("LastDay");
    expect(pillOf("LastDay")).toBe(active);
  });

  it("starts the server's HTML from the server's day, whatever the clock here says", () => {
    atLocal(2031, 1, 1, 12);
    const html = document.createElement("div");
    html.innerHTML = renderToString(page());
    expect(sectionOf(html, happeningNow)).toContain("LastDay");
    expect(sectionOf(html, upcoming)).toContain("Soon");
  });

  it("keeps the stored status when there's no clock at all", () => {
    const html = document.createElement("div");
    html.innerHTML = renderToString(
      <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
        <TripsPageClient trips={TRIPS} displayName="Ana" lifetimeConversions={0} />
      </NextIntlClientProvider>
    );
    expect(sectionOf(html, pastAdventures)).toHaveLength(TRIPS.length);
    expect(html.textContent).not.toContain(memories);
  });
});
