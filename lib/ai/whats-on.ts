/**
 * What is on where and when a trip is, as lines for the plan prompt: what a
 * traveller would be sorry to miss and a plan doesn't think of unasked. Told
 * only the season, a December plan for Prague or Munich could leave out the
 * Christmas markets.
 */
import "server-only";
import tzlookup from "tz-lookup";
import { haversineKm } from "@/lib/map/geo";

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
  /** Only in these years: a line that names one year's dates. */
  years?: readonly number[];
}

/** Within `km` of a place. */
const near = (lat: number, lng: number, km: number) => (p: Point) => haversineKm(p, { lat, lng }) <= km;

/** A month-day moved by whole days (a year without 29 February: these windows are in spring). */
function shift([month, day]: MonthDay, days: number): MonthDay {
  const d = new Date(Date.UTC(2027, month - 1, day + days));
  return [d.getUTCMonth() + 1, d.getUTCDate()];
}

/**
 * A city's cherry blossom, on from two weeks before the average first flowers
 * (recent springs have run early) to ten days after full bloom, with the
 * averages our blossom guide checked (Korea Meteorological Administration).
 * Only Korea: plans for Japan and Washington DC in the season already visit
 * their blossom, while Seoul's could leave it out.
 */
function blossom(where: (p: Point) => boolean, first: MonthDay, full: MonthDay, line: string, years?: readonly number[]): Happening {
  return { from: shift(first, -14), to: shift(full, 10), where, line, ...(years ? { years } : {}) };
}

const BLOSSOM: readonly Happening[] = [
  blossom(
    near(37.5665, 126.978, 40),
    [4, 8],
    [4, 10],
    "Cherry blossom season in Seoul: in an average year the trees first flower on 8 April and are in full bloom on 10 April (Korea Meteorological Administration), but recent springs ran earlier (29 March in 2026, 4 April in 2025). Plan one blossom stop, such as Yeouido's Yunjung-ro or Seokchon Lake, on a day nearest full bloom, and don't promise blossom before the first flowers.",
    [2027]
  ),
  blossom(
    near(35.1796, 129.0756, 45),
    [3, 28],
    [3, 31],
    "Cherry blossom season on Korea's south coast: Busan's trees first flower on 28 March in an average year (Korea Meteorological Administration), and the Jinhae Gunhangje festival in nearby Changwon fills the last days of March and the first of April (27 March to 5 April in 2026; 2027's dates not yet announced). Plan one blossom stop on a day near those dates, and don't promise blossom before the first flowers.",
    [2027]
  ),
  blossom(
    near(35.8562, 129.2247, 30),
    [3, 29],
    [4, 1],
    "Cherry blossom season in Gyeongju: nearby Daegu's trees first flower on 29 March in an average year (Korea Meteorological Administration), and in 2026 the Daereungwon stone-wall road was closed to traffic and lit in the evening for its festival from 3 to 5 April. Plan one blossom stop on a day near those dates, and don't promise blossom before the first flowers.",
    [2027]
  ),
];

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

/**
 * New Year's Eve, wherever the trip is. Told the date is a holiday, a plan still ends it at dinner and leaves out the
 * midnight the city is known for. As an "event" stop it keeps its date and its time when later steps move the days
 * (lib/ai/closing-days.ts) or check opening hours (lib/ai/visit-hours.ts), and it isn't a repeat of a visit to the
 * same place (lib/ai/repeated-sights.ts).
 */
const NEW_YEARS_EVE: Happening = {
  from: [12, 31],
  to: [12, 31],
  where: () => true,
  line:
    "31 December is New Year's Eve: where the place celebrates it (a countdown, fireworks, a square or waterfront that fills), end that day there from about 23:00 to 00:30, as a stop of type 'event' named for the night and the place it is at, after dinner; dinner that night is busy and often a set menu, so its tips say to book ahead. If the trip goes on, 1 January starts late, from about 11:00.",
};

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
  NEW_YEARS_EVE,
  ...BLOSSOM,
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
      if (h.years && !h.years.includes(year)) continue;
      if (isoOf(year, h.from) <= endDate && isoOf(wraps ? year + 1 : year, h.to) >= startDate) return true;
    }
    return false;
  }).map((h) => h.line);
}
