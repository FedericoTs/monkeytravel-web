import { destinations } from "@/lib/destinations/data";
import type { Destination } from "@/lib/destinations/types";
import { PLACE_PHOTOS } from "./photos";
import type { MatchPlace } from "./score";

/** What a place's own tags leave out, for this question set only. */
const ALSO_TAGGED: Readonly<Record<string, readonly string[]>> = {
  paris: ["luxury", "shopping"],
  barcelona: ["nightlife"],
  tokyo: ["shopping", "nightlife"],
  "new-york": ["shopping", "luxury"],
  london: ["shopping", "nightlife"],
  amsterdam: ["nightlife"],
  prague: ["budget"],
  lisbon: ["budget", "nightlife"],
  vienna: ["luxury"],
  berlin: ["budget"],
  bangkok: ["nightlife", "shopping", "budget"],
  bali: ["beach", "budget"],
  seoul: ["shopping"],
  singapore: ["luxury", "shopping"],
  cancun: ["nightlife"],
  "rio-de-janeiro": ["adventure"],
  dubai: ["luxury", "beach"],
  istanbul: ["shopping", "budget"],
  marrakech: ["shopping", "budget", "adventure"],
  "hong-kong": ["luxury", "nightlife", "nature"],
  taipei: ["nature", "nightlife"],
  lima: ["historical"],
  nairobi: ["offbeat"],
  budapest: ["nightlife", "romantic", "budget"],
  bordeaux: ["luxury", "wellness"],
  kyoto: ["wellness", "offbeat"],
  osaka: ["budget", "offbeat"],
  madrid: ["historical"],
  santorini: ["luxury", "wellness", "nature"],
};

/** South American countries, by English name. */
const SOUTH_AMERICA = new Set([
  "Argentina",
  "Bolivia",
  "Brazil",
  "Chile",
  "Colombia",
  "Ecuador",
  "Guyana",
  "Paraguay",
  "Peru",
  "Suriname",
  "Uruguay",
  "Venezuela",
]);

/** The continent a place is on, for how far it is: the Americas are two, as the person's home is. */
function matchContinent(destination: Destination): string {
  if (destination.continent !== "americas") return destination.continent;
  return SOUTH_AMERICA.has(destination.country.en) ? "south-america" : "north-america";
}

/** Every destination with a picked photo; a place without one is left out. */
const IN_THE_MATCH: Destination[] = destinations.filter((destination) => destination.slug in PLACE_PHOTOS);

export const MATCH_PLACES: readonly MatchPlace[] = IN_THE_MATCH.map((destination) => ({
  slug: destination.slug,
  continent: matchContinent(destination),
  budgetLevel: destination.stats.budgetLevel,
  bestMonths: destination.stats.bestMonths,
  tags: [...destination.tags, ...(ALSO_TAGGED[destination.slug] ?? [])],
  stayDays: destination.stats.avgStayDays,
}));

export function matchDestination(slug: string): Destination {
  const destination = IN_THE_MATCH.find((candidate) => candidate.slug === slug);
  if (!destination) throw new Error(`Not in the match: ${slug}`);
  return destination;
}

export const matchDestinations = (): readonly Destination[] => IN_THE_MATCH;
