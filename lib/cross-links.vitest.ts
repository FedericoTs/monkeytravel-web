import { describe, it, expect } from "vitest";
import { getBlogPostsForDestination, getDestinationsForBlogPost } from "./cross-links";

/**
 * Keywords match whole words. As substrings, "paris" matched "comparison",
 * "roma" matched "romantic" and "rio" matched "itinerario", so AI planner
 * reviews offered a Paris trip and the Rio page listed Puglia itineraries.
 */
describe("blog ↔ destination cross-links", () => {
  const slugsFor = (slug: string, tags: string[]) => getDestinationsForBlogPost(slug, tags, 3).map((d) => d.slug);

  it("does not match a keyword inside another word", () => {
    expect(slugsFor("best-ai-trip-planners-2026-compared", ["ai trip planner", "comparison"])).toEqual([]);
    expect(slugsFor("honeymoon-planning-guide", ["romantic travel"])).toEqual([]);
    expect(slugsFor("itinerario-puglia-5-giorni", ["itinerario", "puglia"])).toEqual([]);
  });

  it("still matches whole words in slugs and tags", () => {
    expect(slugsFor("3-day-paris-itinerary", ["city guide", "paris"])).toContain("paris");
    expect(slugsFor("some-post", ["hong kong"])).toContain("hong-kong");
  });

  it("the Rio page lists no Italian itineraries", () => {
    expect(getBlogPostsForDestination("rio-de-janeiro").filter((s) => s.startsWith("itinerario-"))).toEqual([]);
  });

  it("a destination page lists posts named after the city first", () => {
    expect(getBlogPostsForDestination("paris")).toEqual(["3-day-paris-itinerary", "paris-vs-barcelona", "paris-vs-rome"]);
    expect(getBlogPostsForDestination("lisbon").slice(0, 2)).toEqual(["lisbon-3-day-itinerary", "lisbon-vs-porto"]);
  });
});
