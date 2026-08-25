import { describe, it, expect } from "vitest";
import { POSTS } from "./tag-taxonomy";
import {
  daysFromSlug,
  tripPrefillForPost,
  tripsNewHrefForPost,
  MAX_PREFILL_DAYS,
} from "./trip-prefill";

/**
 * These run against the REAL taxonomy, not fixtures, because the property that
 * matters is "does the prefill match what the article actually says" — and a
 * fixture can't be wrong about that. The same reason related-posts tests read
 * the real content tree.
 */

describe("daysFromSlug", () => {
  it("reads the day count the headline promises", () => {
    expect(daysFromSlug("3-day-paris-itinerary")).toBe(3);
    expect(daysFromSlug("london-4-day-itinerary")).toBe(4);
    expect(daysFromSlug("bali-7-day-itinerary")).toBe(7);
  });

  it("reads the Italian-authored slugs", () => {
    expect(daysFromSlug("itinerario-puglia-5-giorni")).toBe(5);
    expect(daysFromSlug("itinerario-sardegna-7-giorni")).toBe(7);
  });

  it("returns null rather than guessing", () => {
    expect(daysFromSlug("greek-island-hopping-itinerary")).toBeNull();
    expect(daysFromSlug("passport-power-index-2026")).toBeNull();
    // A year is not a day count.
    expect(daysFromSlug("travel-planning-trends-2026")).toBeNull();
    expect(daysFromSlug("layla-vs-mindtrip-2026")).toBeNull();
  });
});

describe("tripPrefillForPost", () => {
  it("prefills the trip the article describes", () => {
    expect(tripPrefillForPost("3-day-paris-itinerary")).toEqual({ days: 3 });
    expect(tripPrefillForPost("bali-7-day-itinerary")).toEqual({ days: 7 });
  });

  it("lets the slug's number beat the length concept", () => {
    // Carries `weekend-trip` (which would say 3) but the headline says 4.
    expect(POSTS["tokyo-4-day-itinerary"].c).toContain("weekend-trip");
    expect(tripPrefillForPost("tokyo-4-day-itinerary").days).toBe(4);

    // Carries `week-long-trip` (7) but the headline says 5.
    expect(POSTS["bangkok-5-day-itinerary"].c).toContain("week-long-trip");
    expect(tripPrefillForPost("bangkok-5-day-itinerary").days).toBe(5);
  });

  it("falls back to the length concept only when the slug is silent", () => {
    expect(tripPrefillForPost("plan-weekend-getaway-with-ai").days).toBe(3);
    expect(tripPrefillForPost("itinerario-sardegna-7-giorni").days).toBe(7);
  });

  it("opens the route builder for route articles", () => {
    expect(tripPrefillForPost("greek-island-hopping-itinerary").multi).toBe(true);
    expect(tripPrefillForPost("japan-golden-route-itinerary").multi).toBe(true);
    expect(tripPrefillForPost("how-to-plan-a-multi-city-trip").multi).toBe(true);
  });

  it("never sends a day span into multi-city mode", () => {
    // The wizard recomputes the end date from per-city nights, and a long
    // single-city span is the documented way to earn a 400 from generate.
    for (const slug of Object.keys(POSTS)) {
      const p = tripPrefillForPost(slug);
      if (p.multi) expect(p.days).toBeUndefined();
    }
    // 5-day-italy is the sharp case: the slug states 5 AND it is a route.
    expect(tripPrefillForPost("5-day-italy-itinerary")).toEqual({ multi: true });
  });

  it("does not open the route builder for a stats article that merely counts routes", () => {
    expect(POSTS["most-planned-destinations-2026"].c).toContain("multi-city-trip");
    expect(tripPrefillForPost("most-planned-destinations-2026").multi).toBeUndefined();
  });

  it("sets the budget tier for budget articles", () => {
    expect(tripPrefillForPost("how-to-plan-trip-to-italy-on-a-budget").budget).toBe("budget");
    expect(tripPrefillForPost("cheapest-destinations-in-europe").budget).toBe("budget");
    expect(tripPrefillForPost("3-day-paris-itinerary").budget).toBeUndefined();
  });

  it("does not set the budget tier for money-admin posts that merely mention budget", () => {
    // Carries budget-travel, but it is a guide to SPLITTING costs among
    // friends, not a request for a shoestring trip.
    expect(POSTS["group-trip-budget-how-to-split-costs"].c).toContain("budget-travel");
    expect(tripPrefillForPost("group-trip-budget-how-to-split-costs").budget).toBeUndefined();
    // Same shape: a destination comparison that weighs cost among other things.
    expect(POSTS["bali-vs-thailand"].c).toContain("budget-travel");
    expect(tripPrefillForPost("bali-vs-thailand").budget).toBeUndefined();
  });

  it("sets a vibe only where the vibe IS the subject", () => {
    expect(tripPrefillForPost("best-food-destinations-2026").vibes).toEqual(["foodie"]);
    expect(tripPrefillForPost("best-honeymoon-destinations-2026").vibes).toEqual(["romantic"]);
    expect(tripPrefillForPost("best-fall-foliage-destinations").vibes).toEqual(["nature"]);
    // city-guide is deliberately unmapped — a Paris vs Barcelona comparison is
    // not a request for an urban trip.
    expect(POSTS["paris-vs-barcelona"].c).toContain("city-guide");
    expect(tripPrefillForPost("paris-vs-barcelona").vibes).toBeUndefined();
  });

  it("is empty for posts that describe no trip", () => {
    expect(tripPrefillForPost("passport-power-index-2026")).toEqual({});
    expect(tripPrefillForPost("layla-vs-mindtrip-2026")).toEqual({});
    expect(tripPrefillForPost("travel-packing-checklist")).toEqual({});
  });

  it("is empty for an unknown slug instead of throwing", () => {
    expect(tripPrefillForPost("not-a-real-post")).toEqual({});
  });

  it("never exceeds the wizard's single-city day cap", () => {
    for (const slug of Object.keys(POSTS)) {
      const days = tripPrefillForPost(slug).days;
      if (days !== undefined) {
        expect(days).toBeGreaterThanOrEqual(1);
        expect(days).toBeLessThanOrEqual(MAX_PREFILL_DAYS);
      }
    }
  });

  it("only ever emits vibes the step-2 UI renders", () => {
    const RENDERED = new Set(["adventure", "cultural", "foodie", "romantic", "nature", "urban"]);
    for (const slug of Object.keys(POSTS)) {
      for (const v of tripPrefillForPost(slug).vibes ?? []) {
        expect(RENDERED.has(v)).toBe(true);
      }
    }
  });
});

describe("tripsNewHrefForPost", () => {
  it("carries the whole trip, not just the city", () => {
    expect(tripsNewHrefForPost("3-day-paris-itinerary", "paris")).toBe(
      "/trips/new?destination=paris&days=3",
    );
    expect(tripsNewHrefForPost("how-to-plan-trip-to-italy-on-a-budget", "rome")).toBe(
      "/trips/new?destination=rome&budget=budget",
    );
  });

  it("prefills a length even with no destination to offer", () => {
    expect(tripsNewHrefForPost("plan-weekend-getaway-with-ai", null)).toBe(
      "/trips/new?days=3",
    );
  });

  it("stays bare when there is nothing honest to prefill", () => {
    expect(tripsNewHrefForPost("layla-vs-mindtrip-2026", null)).toBe("/trips/new");
    expect(tripsNewHrefForPost("passport-power-index-2026", null)).toBe("/trips/new");
  });

  it("sends route articles to the route builder without a span", () => {
    expect(tripsNewHrefForPost("greek-island-hopping-itinerary", null)).toBe(
      "/trips/new?multi=1",
    );
  });

  it("produces a URL the wizard's own parser accepts", () => {
    // Guards the contract with app/[locale]/trips/new/page.tsx: days must be an
    // int in 1..14, budget one of three, vibes from the rendered set.
    for (const slug of Object.keys(POSTS)) {
      const href = tripsNewHrefForPost(slug, null);
      const qs = new URLSearchParams(href.split("?")[1] ?? "");
      const days = qs.get("days");
      if (days !== null) {
        const n = Number.parseInt(days, 10);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(MAX_PREFILL_DAYS);
      }
      const budget = qs.get("budget");
      if (budget !== null) {
        expect(["budget", "balanced", "premium"]).toContain(budget);
      }
    }
  });
});

describe("coverage", () => {
  it("prefills a meaningful share of the blog without over-reaching", () => {
    const slugs = Object.keys(POSTS);
    const withPrefill = slugs.filter(
      (s) => Object.keys(tripPrefillForPost(s)).length > 0,
    );
    // Sanity rails, not targets. Too few means the derivation broke; too many
    // means it started guessing — the failure mode this module exists to avoid.
    expect(withPrefill.length).toBeGreaterThan(20);
    expect(withPrefill.length).toBeLessThan(slugs.length * 0.6);
  });
});
