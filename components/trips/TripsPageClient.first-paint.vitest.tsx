import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
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
 * /trips renders on the server and hydrates in the browser. The first card's
 * cover is the page's largest image: it must be in the server HTML with its
 * final section, size and priority, and hydration must keep that same <img>
 * (a replaced one is painted again, after the JavaScript has loaded).
 */

const SERVER_NOW = "2026-10-12T12:00:00.000Z";

const trip = (id: string, title: string, start: string, end: string, created: string, cover: string) => ({
  id, title, start_date: start, end_date: end, status: "planning",
  cover_image_url: cover, created_at: created, is_archived: false,
});

// Newest first: Lisbon (past), Kyoto (upcoming), Rome (past). Upcoming renders
// before Past, so Kyoto is the first card on screen.
const TRIPS = [
  trip("t-lisbon", "Lisbon Trip", "2020-05-01", "2020-05-05", "2026-10-10T10:00:00Z",
    "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&cs=tinysrgb&w=800&h=600"),
  trip("t-kyoto", "Kyoto Trip", "2030-04-01", "2030-04-08", "2026-10-01T10:00:00Z",
    "/api/places/photo?name=places%2Fabc%2Fphotos%2Fxyz&w=1920&h=1200&t=destination"),
  trip("t-rome", "Rome Trip", "2021-01-01", "2021-01-03", "2026-09-01T10:00:00Z",
    "https://images.pexels.com/photos/2/pexels-photo-2.jpeg?auto=compress&cs=tinysrgb&w=800&h=600"),
];

const page = () => (
  <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
    <TripsPageClient trips={TRIPS} displayName="Ana" lifetimeConversions={0} serverNow={SERVER_NOW} />
  </NextIntlClientProvider>
);

const img = (root: ParentNode, title: string) => root.querySelector<HTMLImageElement>(`img[alt="${title}"]`);
const sectionTitleOf = (el: Element | null) =>
  el?.closest(".mb-8")?.querySelector("h2")?.textContent ?? null;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = root = null;
});

describe("/trips first paint", () => {
  it("sorts the server HTML by the server's clock", () => {
    const html = document.createElement("div");
    html.innerHTML = renderToString(page());
    expect(sectionTitleOf(img(html, "Kyoto Trip"))).toBe(common.trips.upcoming);
    expect(sectionTitleOf(img(html, "Lisbon Trip"))).toBe(common.trips.pastAdventures);
  });

  it("loads the first card's cover first, at card size, and the others lazily", () => {
    const html = document.createElement("div");
    html.innerHTML = renderToString(page());
    const first = img(html, "Kyoto Trip")!;
    expect(first.getAttribute("fetchpriority")).toBe("high");
    expect(first.getAttribute("loading")).toBe("eager");
    expect(first.getAttribute("src")).toContain("w=800&h=500");
    for (const title of ["Lisbon Trip", "Rome Trip"]) {
      expect(img(html, title)!.getAttribute("loading")).toBe("lazy");
      expect(img(html, title)!.hasAttribute("fetchpriority")).toBe(false);
    }
  });

  it("keeps the same cover <img> through hydration, with no recoverable error", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    container.innerHTML = renderToString(page());
    document.body.appendChild(container);
    const before = img(container, "Kyoto Trip");
    const errors: unknown[] = [];

    await act(async () => {
      root = hydrateRoot(container!, page(), { onRecoverableError: (e) => errors.push(e) });
    });

    expect(errors).toEqual([]);
    const after = img(container, "Kyoto Trip");
    expect(after).not.toBeNull();
    expect(after).toBe(before);
    expect(sectionTitleOf(after)).toBe(common.trips.upcoming);
  });
});
