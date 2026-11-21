/**
 * What is on where and when a trip is, as lines for the plan prompt: what a
 * traveller would be sorry to miss and a plan doesn't think of unasked. Told
 * only the season, a December plan for Prague or Munich could leave out the
 * Christmas markets.
 */
import "server-only";
import tzlookup from "tz-lookup";

type Point = { lat: number; lng: number };
/** [month, day], 1-based. */
type MonthDay = readonly [number, number];

interface Happening {
  /** First day, inclusive. */
  from: MonthDay;
  /** Last day, inclusive; earlier in the year than `from` when it runs into the next one. */
  to: MonthDay;
  where: (p: Point) => boolean;
  line: string;
}

/** European zones where Christmas markets aren't the custom. */
const NOT_THE_CUSTOM = new Set([
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Europe/Volgograd",
  "Europe/Kirov",
  "Europe/Astrakhan",
  "Europe/Saratov",
  "Europe/Ulyanovsk",
  "Europe/Simferopol",
  "Europe/Minsk",
]);

/**
 * Europe, where Christmas markets are the custom, by the place's time zone: it
 * puts Tunis and Tangier in Africa and Izmir in Turkey, where a box of
 * coordinates around Europe takes them in.
 */
function inEurope(p: Point): boolean {
  let zone: string;
  try {
    zone = tzlookup(p.lat, p.lng);
  } catch {
    return false;
  }
  return zone.startsWith("Europe/") && !NOT_THE_CUSTOM.has(zone);
}

const HAPPENINGS: readonly Happening[] = [
  {
    from: [11, 21],
    to: [12, 23],
    where: inEurope,
    line:
      "Christmas markets are open (most of Europe's from late November to 23 or 24 December): spend one evening at the city's best-known market, a second market on another day at most, late in the afternoon or in the evening, when the lights are on.",
  },
  {
    from: [12, 24],
    to: [1, 6],
    where: inEurope,
    line: "Most Christmas markets close on 23 or 24 December and a few stay open into early January: include one only where you know it is open on that day.",
  },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = (year: number, [month, day]: MonthDay) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** The lines for what is on at `point` between the two dates (YYYY-MM-DD, both counted). None when either is unknown. */
export function whatsOn(point: Point | null, startDate: unknown, endDate: unknown): string[] {
  if (!point || typeof startDate !== "string" || typeof endDate !== "string") return [];
  if (!ISO_DAY.test(startDate) || !ISO_DAY.test(endDate) || endDate < startDate) return [];
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  return HAPPENINGS.filter((h) => {
    if (!h.where(point)) return false;
    const wraps = h.to[0] < h.from[0] || (h.to[0] === h.from[0] && h.to[1] < h.from[1]);
    // From the year before, for a window that began then and runs into the trip's.
    for (let year = firstYear - 1; year <= lastYear; year++) {
      if (isoOf(year, h.from) <= endDate && isoOf(wraps ? year + 1 : year, h.to) >= startDate) return true;
    }
    return false;
  }).map((h) => h.line);
}
