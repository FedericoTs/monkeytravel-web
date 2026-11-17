/**
 * The planner landing pages. The sitemap and the footer both read this list, so a
 * new page gets its links with no second step. Google gives little weight to a page
 * only the sitemap mentions.
 */
export const PLANNER_PAGES = [
  { path: "/free-ai-trip-planner", label: "freeAi" },
  { path: "/group-trip-planner", label: "group" },
  { path: "/family-trip-planner", label: "family" },
  { path: "/solo-trip-planner", label: "solo" },
  { path: "/weekend-trip-planner", label: "weekend" },
  { path: "/budget-trip-planner", label: "budget" },
  { path: "/multi-city-trip-planner", label: "multiCity" },
  { path: "/backpacker", label: "backpacker" },
  { path: "/ai-itinerary-generator", label: "itinerary" },
] as const;

/**
 * The footer's list, on every page. The home page comes first under its own words: "Free AI Trip Planner" is its
 * title. The free-planner and itinerary pages stay out of the footer: they ask for the home page's own searches,
 * and a link from every page under those words tells Google another page is the site's answer to them. They stay in
 * the sitemap and in the articles that name them.
 */
export const FOOTER_PLANNERS: ReadonlyArray<{ path: string; label: (typeof PLANNER_PAGES)[number]["label"] }> = [
  { path: "/", label: "freeAi" },
  ...PLANNER_PAGES.filter(({ path }) => path !== "/free-ai-trip-planner" && path !== "/ai-itinerary-generator"),
];
