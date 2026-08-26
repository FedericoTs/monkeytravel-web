import { describe, it, expect } from "vitest";
import {
  seasonalDestinationsForPost,
  SEASONAL_PICKS_RAW,
  SEASONAL_POST_SLUGS,
} from "./seasonal-destinations";
import { destinations } from "@/lib/destinations/data";

/**
 * This map is hand-maintained, and both halves of every entry can rot
 * independently: a destination can be renamed in lib/destinations/data.ts, or
 * a post can be renamed in content/blog/. Either one fails silently in
 * production — the block just renders one card fewer, or disappears — which
 * is exactly the class of quiet regression the block was built to fix.
 */
describe("seasonal destination picks", () => {
  const knownSlugs = new Set(destinations.map((d) => d.slug));

  it("every curated destination slug resolves to a real destination", () => {
    const dangling: string[] = [];
    for (const [post, picks] of Object.entries(SEASONAL_PICKS_RAW)) {
      for (const slug of picks) {
        if (!knownSlugs.has(slug)) dangling.push(`${post} → ${slug}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("resolves every post to at least one destination", () => {
    // A curated post that resolves to nothing renders no block at all, which
    // would silently undo the change.
    for (const post of SEASONAL_POST_SLUGS) {
      expect(seasonalDestinationsForPost(post)!.length).toBeGreaterThan(0);
    }
  });

  it("gives every picked destination something to actually list", () => {
    // The card prints up to 3 non-meal activities. A destination with none
    // would render a card with a title and no content.
    const DOING = ["sightseeing", "museum", "walk", "activity", "nightlife", "shopping"];
    for (const post of SEASONAL_POST_SLUGS) {
      for (const dest of seasonalDestinationsForPost(post)!) {
        const doable = dest.content.sampleDay.activities.filter((a) => DOING.includes(a.type));
        expect(
          doable.length,
          `${post} → ${dest.slug} has no non-meal activities to show`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("has all four locales on every string it renders", () => {
    // A missing locale renders `undefined` into the card. pt is the one that
    // has historically been forgotten.
    for (const post of SEASONAL_POST_SLUGS) {
      for (const dest of seasonalDestinationsForPost(post)!) {
        for (const loc of ["en", "es", "it", "pt"] as const) {
          expect(dest.name[loc], `${dest.slug}.name.${loc}`).toBeTruthy();
          expect(dest.content.tagline[loc], `${dest.slug}.tagline.${loc}`).toBeTruthy();
          for (const a of dest.content.sampleDay.activities) {
            expect(a.title[loc], `${dest.slug} activity title.${loc}`).toBeTruthy();
          }
        }
      }
    }
  });

  it("keeps Tokyo off the monsoon guide", () => {
    // The regression this map exists to fix: the keyword matcher returned
    // tokyo/bangkok/bali for this post, because Tokyo's keyword list contains
    // "asia" and the post carries an "asia" tag. Tokyo is not a monsoon
    // destination and the article never mentions it.
    const picks = seasonalDestinationsForPost("monsoon-season-where-to-go-and-avoid")!;
    expect(picks.map((d) => d.slug)).not.toContain("tokyo");
    expect(picks.map((d) => d.slug)).toContain("bali");
  });

  it("returns null — not [] — for a post with no curation", () => {
    // The page distinguishes these: null means "fall back to the keyword
    // matcher", [] would mean "curated to nothing, render neither section".
    expect(seasonalDestinationsForPost("best-ai-trip-planners-2026-compared")).toBeNull();
  });

  it("does not curate more than three destinations for one post", () => {
    // The grid is 3-up on desktop; a fourth card wraps alone on a new row.
    for (const post of SEASONAL_POST_SLUGS) {
      expect(seasonalDestinationsForPost(post)!.length).toBeLessThanOrEqual(3);
    }
  });
});
