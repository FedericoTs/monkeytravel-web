/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";

/**
 * My trips shows the referral program's progress banner only while referrals
 * are switched on. The banner is the page's one lazily loaded part.
 */

vi.mock("next/dynamic", () => ({ default: () => () => <aside aria-label="referral progress" /> }));
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

const TRIPS = [
  {
    id: "t-kyoto", title: "Kyoto Trip", start_date: "2030-04-01", end_date: "2030-04-08", status: "planning",
    cover_image_url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&cs=tinysrgb&w=800&h=600",
    created_at: "2026-10-01T10:00:00Z", is_archived: false,
  },
];

function show() {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }} onError={() => {}}>
      <TripsPageClient trips={TRIPS} displayName="Ana" lifetimeConversions={0} serverToday="2026-10-12" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("My trips and the referral banner", () => {
  it("shows no banner with referrals switched off", () => {
    vi.stubEnv("NEXT_PUBLIC_REFERRALS_ENABLED", "false");
    show();
    expect(screen.getByText("Kyoto Trip")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "referral progress" })).toBeNull();
  });

  it("shows it with them on", () => {
    vi.stubEnv("NEXT_PUBLIC_REFERRALS_ENABLED", "true");
    show();
    expect(screen.getByRole("complementary", { name: "referral progress" })).toBeTruthy();
  });
});
