import { describe, expect, it } from "vitest";
import { getAllFrontmatter } from "./api";
import { readerIsChoosing } from "./choosing";
import { getPrimaryDestinationFromTags } from "./primaryDestination";
import type { BlogFrontmatter } from "./types";

const choosing = (post: BlogFrontmatter, locale: string) => readerIsChoosing(post, getPrimaryDestinationFromTags(post.tags, locale) !== null);

function bySlug(locale: string): Map<string, BlogFrontmatter> {
  return new Map(getAllFrontmatter(locale).map((post) => [post.slug, post]));
}

describe("who's still choosing where to go", () => {
  const english = bySlug("en");
  const post = (slug: string) => {
    const found = english.get(slug);
    if (!found) throw new Error(`no post ${slug}`);
    return found;
  };

  it("is the reader of a seasonal piece or a list of places", () => {
    expect(choosing(post("where-to-go-in-january"), "en")).toBe(true);
    expect(choosing(post("2027-travel-calendar"), "en")).toBe(true);
    expect(choosing(post("best-places-to-travel-2027"), "en")).toBe(true);
    expect(choosing(post("cheapest-destinations-in-asia"), "en")).toBe(true);
  });

  it("isn't the reader of a guide to one place, or of advice that isn't about where", () => {
    expect(choosing(post("bangkok-5-day-itinerary"), "en")).toBe(false);
    expect(choosing(post("3-day-paris-itinerary"), "en")).toBe(false);
    expect(choosing(post("travel-packing-checklist"), "en")).toBe(false);
    // A seasonal piece about one city has already chosen.
    expect(readerIsChoosing({ category: "Seasonal Travel", tags: ["best destinations"] }, true)).toBe(false);
  });

  it("is the same in every language a post is translated into", () => {
    const differ: string[] = [];
    for (const locale of ["es", "it", "pt"]) {
      for (const [slug, translated] of bySlug(locale)) {
        const original = english.get(slug);
        if (original && choosing(translated, locale) !== choosing(original, "en")) differ.push(`${locale}/${slug}`);
      }
    }
    expect(differ).toEqual([]);
  });
});
