/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";

/**
 * My trips shows the curated templates (to a new traveller above the empty
 * page, to one with trips at the bottom) only while templates are switched on.
 */

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
vi.mock("@/components/templates/CuratedEscapesClient", () => ({
  default: () => <section aria-label="curated templates" />,
}));
vi.mock("@/components/blog/BlogTipsSection", () => ({ default: () => null }));
vi.mock("@/components/referral/ReferralModal", () => ({ default: () => null }));
vi.mock("@/components/trips/TripActionModal", () => ({ default: () => null }));

import TripsPageClient from "./TripsPageClient";

const KYOTO = {
  id: "t-kyoto", title: "Kyoto Trip", start_date: "2030-04-01", end_date: "2030-04-08", status: "planning",
  cover_image_url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&cs=tinysrgb&w=800&h=600",
  created_at: "2026-10-01T10:00:00Z", is_archived: false,
};

function show(trips: (typeof KYOTO)[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
      <TripsPageClient trips={trips} displayName="Ana" lifetimeConversions={0} serverToday="2026-10-12" />
    </NextIntlClientProvider>,
  );
}

const templates = () => screen.queryByRole("region", { name: "curated templates" });

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("My trips and the curated templates", () => {
  it.each([
    ["a traveller with no trips", []],
    ["a traveller with trips", [KYOTO]],
  ])("shows none to %s with templates switched off", (_who, trips) => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    show(trips);
    expect(templates()).toBeNull();
  });

  it.each([
    ["a traveller with no trips", []],
    ["a traveller with trips", [KYOTO]],
  ])("shows them to %s with templates on", (_who, trips) => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "true");
    show(trips);
    expect(templates()).toBeTruthy();
  });

  it("keeps the trips and the way to plan one with templates off", () => {
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "false");
    show([KYOTO]);
    expect(screen.getByText("Kyoto Trip")).toBeTruthy();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/trips/new")).toBe(true);
  });
});
