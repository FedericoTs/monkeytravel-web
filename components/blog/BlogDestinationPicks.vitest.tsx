/**
 * Tests for the stay-CTA disclosure logic on BlogDestinationPicks.
 *
 * The CTA renders whether or not the Hostelworld affiliate is live (product
 * decision 2026-08-26 — there is no AWIN account yet and the link is useful
 * on its own). That makes one invariant load-bearing:
 *
 *   rel="sponsored" and the "Affiliate link" note are DISCLOSURES. Both must
 *   appear only when the link actually pays us, and both must appear together.
 *
 * Getting this wrong is not a rendering bug, it is a false statement about a
 * commercial relationship — `sponsored` tells Google money changes hands, and
 * the visible note tells the reader the same. It is invisible in production
 * (the page looks identical either way), which is why it is pinned here.
 *
 * PartnerButton is stubbed to a prop recorder: what it renders is its own
 * problem, what it is HANDED is this component's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Destination } from "@/lib/destinations/types";

const isActive = vi.fn<() => boolean>();

vi.mock("@/lib/affiliates/hostelworld", () => ({
  isHostelworldAffiliateActive: () => isActive(),
  // Mirrors the real builder closely enough to assert the city and dates
  // reach it; the real URL shape is covered by the module's own callers.
  getHostelworldSearchUrl: ({
    destination,
    startDate,
    endDate,
  }: {
    destination: string;
    startDate: string;
    endDate: string;
  }) => `https://www.hostelworld.com/s?k=${destination}&a=${startDate}&b=${endDate}`,
}));

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Test stub. next/image needs a Next runtime jsdom does not provide, and this
// element exists only so the card has something in its image slot.
vi.mock("@/components/ui/ImageWithFallback", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock("@/lib/blog/trip-prefill", () => ({
  tripsNewHrefForPost: (_slug: string, dest: string) => `/trips/new?destination=${dest}`,
}));

const partnerProps: Record<string, unknown>[] = [];
vi.mock("@/components/booking/PartnerButton", () => ({
  default: (props: Record<string, unknown>) => {
    partnerProps.push(props);
    return (
      <a data-testid="stay-cta" href={String(props.href)} rel={String(props.rel)}>
        {props.children as ReactNode}
      </a>
    );
  },
}));

import BlogDestinationPicks from "./BlogDestinationPicks";

const L = (s: string) => ({ en: s, es: s, it: s, pt: s });

/** Four "doing" activities and two meals, so the 3-cap and the filter both bite. */
const DEST = {
  slug: "kyoto",
  name: L("Kyoto"),
  content: {
    tagline: L("A thousand temples"),
    sampleDay: {
      activities: [
        { time: "07:30", type: "breakfast", title: L("Kissaten breakfast"), description: L("") },
        { time: "09:00", type: "sightseeing", title: L("Fushimi Inari"), description: L("") },
        { time: "11:00", type: "walk", title: L("Higashiyama lanes"), description: L("") },
        { time: "13:00", type: "lunch", title: L("Nishiki Market"), description: L("") },
        { time: "15:00", type: "museum", title: L("Kyoto National Museum"), description: L("") },
        { time: "18:00", type: "nightlife", title: L("Pontocho at dusk"), description: L("") },
      ],
    },
  },
} as unknown as Destination;

const LABELS = {
  heading: "Ready to plan?",
  thingsToDo: "What to do",
  whereToEat: "Where to eat",
  planCta: "Plan a trip to {city}",
  stayCta: "Find a place to stay",
  affiliateNote: "Affiliate link",
};

function renderBlock(postSlug = "where-to-go-in-october") {
  return render(
    <BlogDestinationPicks
      destinations={[DEST]}
      locale="en"
      postSlug={postSlug}
      labels={LABELS}
    />,
  );
}

describe("BlogDestinationPicks — stay CTA disclosure", () => {
  beforeEach(() => {
    partnerProps.length = 0;
    isActive.mockReset();
  });

  it("renders the CTA WITHOUT sponsored or a note when the affiliate is off", () => {
    isActive.mockReturnValue(false);
    renderBlock();

    expect(screen.getByTestId("stay-cta")).toBeTruthy();
    expect(partnerProps[0].rel).toBe("noopener nofollow");
    expect(String(partnerProps[0].rel)).not.toContain("sponsored");
    expect(screen.queryByText("Affiliate link")).toBeNull();
    expect(partnerProps[0].extraEventProps).toMatchObject({ is_affiliate_active: false });
  });

  it("adds sponsored AND the note together when the affiliate is on", () => {
    isActive.mockReturnValue(true);
    renderBlock();

    expect(partnerProps[0].rel).toBe("sponsored noopener nofollow");
    expect(screen.getByText("Affiliate link")).toBeTruthy();
    expect(partnerProps[0].extraEventProps).toMatchObject({ is_affiliate_active: true });
  });

  it("never shows the note without sponsored, or the reverse", () => {
    // The two disclosures must agree. Asserted across both states as one
    // property, because a future edit could easily move only one of them.
    for (const active of [true, false]) {
      partnerProps.length = 0;
      isActive.mockReturnValue(active);
      const { unmount } = renderBlock();
      const hasSponsored = String(partnerProps[0].rel).includes("sponsored");
      const hasNote = screen.queryByText("Affiliate link") !== null;
      expect(hasSponsored).toBe(hasNote);
      unmount();
    }
  });

  it("drops the stay CTA entirely for a post with no single month", () => {
    isActive.mockReturnValue(true);
    renderBlock("monsoon-season-where-to-go-and-avoid");
    expect(screen.queryByTestId("stay-cta")).toBeNull();
    // ...but the card itself still renders.
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });

  it("passes the city and the post's own month through to the stay link", () => {
    isActive.mockReturnValue(false);
    renderBlock("where-to-go-in-october");
    const href = String(partnerProps[0].href);
    expect(href).toContain("k=Kyoto");
    expect(href).toMatch(/a=\d{4}-10-10&b=\d{4}-10-14/);
  });
});

describe("BlogDestinationPicks — activity selection", () => {
  beforeEach(() => {
    partnerProps.length = 0;
    isActive.mockReturnValue(false);
  });

  it("lists at most three things to do and excludes meals from them", () => {
    renderBlock();
    expect(screen.getByText("Fushimi Inari")).toBeTruthy();
    expect(screen.getByText("Higashiyama lanes")).toBeTruthy();
    expect(screen.getByText("Kyoto National Museum")).toBeTruthy();
    // 4th "doing" item is over the cap.
    expect(screen.queryByText("Pontocho at dusk")).toBeNull();
    // Lunch is a meal, never a "thing to do".
    expect(screen.queryByText("Nishiki Market")).toBeNull();
  });

  it("uses the first meal as the where-to-eat line", () => {
    renderBlock();
    expect(screen.getByText("Kissaten breakfast")).toBeTruthy();
  });

  it("substitutes the city into the planner CTA", () => {
    renderBlock();
    expect(screen.getByText("Plan a trip to Kyoto")).toBeTruthy();
  });
});
