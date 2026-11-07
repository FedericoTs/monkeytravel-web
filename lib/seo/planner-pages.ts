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
