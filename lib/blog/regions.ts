/**
 * Blog post region/continent mapping
 *
 * Maps blog slugs to geographic regions for filtering.
 * Posts not explicitly mapped default to "Worldwide".
 */

export type BlogRegion =
  | "Europe"
  | "Asia"
  | "Americas"
  | "Africa"
  | "Worldwide";

export const BLOG_REGIONS: Record<string, BlogRegion> = {
  // Europe (10)
  "3-day-paris-itinerary": "Europe",
  "5-day-italy-itinerary": "Europe",
  "barcelona-3-day-itinerary": "Europe",
  "london-4-day-itinerary": "Europe",
  "istanbul-3-day-itinerary": "Europe",
  "lisbon-3-day-itinerary": "Europe",
  "cheapest-destinations-in-europe": "Europe",
  "paris-vs-rome": "Europe",
  "how-to-plan-trip-to-italy-on-a-budget": "Europe",
  "midnight-sun-best-destinations": "Europe",

  // Asia (8)
  "tokyo-4-day-itinerary": "Asia",
  "bali-7-day-itinerary": "Asia",
  "bangkok-5-day-itinerary": "Asia",
  "cheapest-destinations-in-asia": "Asia",
  "bali-vs-thailand": "Asia",
  "japan-cherry-blossom-season-guide": "Asia",
  "monsoon-season-where-to-go-and-avoid": "Asia",
  "first-trip-to-japan-what-you-need-to-know": "Asia",

  // Americas (1)
  "new-york-5-day-itinerary": "Americas",

  // Africa (1)
  "great-migration-africa-when-and-where": "Africa",
};

/**
 * Get the geographic region for a blog post.
 * Returns "Worldwide" for posts not in the explicit mapping.
 */
export function getRegionForPost(slug: string): BlogRegion {
  return BLOG_REGIONS[slug] ?? "Worldwide";
}

/** All available regions in display order */
export const ALL_REGIONS: BlogRegion[] = [
  "Europe",
  "Asia",
  "Americas",
  "Africa",
  "Worldwide",
];
