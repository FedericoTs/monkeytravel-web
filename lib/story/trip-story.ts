/**
 * A trip told as a story: the slides a friend taps through on a share link, and the guess that opens it.
 * Everything comes from the plan itself, so a story costs no model call and can't say what the plan doesn't.
 */
import { destinations } from "@/lib/destinations/data";
import type { Continent, Locale } from "@/lib/destinations/types";
import { haversineKm } from "@/lib/map/geo";
import { routeSketch, type Sketch } from "@/lib/og/route-sketch";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { isRide } from "@/lib/trip/far-pins";
import { isDayStop, isMealStop } from "@/lib/trip/pace";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import { getTripDestination } from "@/lib/trips/destination";

export type StoryRegion = "europe" | "asia" | "africa" | "americas" | "oceania" | "atlantic" | "indian";

/** A clue never names the place. They run from far to near: the last one all but gives it away. */
export type StoryClue =
  | { kind: "when"; days: number; month: number | null; region: StoryRegion | null }
  | { kind: "mix"; sights: number; meals: number; outdoors: number }
  | { kind: "letters"; first: string; letters: number; words: number };

export interface StoryGuess {
  clues: StoryClue[];
  /** Four places, the trip's among them, in an order that is the same for everyone who opens the link. */
  options: string[];
  answer: number;
}

export interface StoryDay {
  day: number;
  date: string | null;
  city: string | null;
  title: string | null;
  /** The day's first names, sights before meals. */
  stops: string[];
  /** Stops of the day that are not named. */
  more: number;
  /** The day's own stops joined in order: the shape of the day. Null when fewer than two have a pin. */
  route: Sketch | null;
}

export interface TripStory {
  /** The place by its short name, as the guess and the reveal show it. */
  place: string;
  /** The destination as the trip names it. */
  destination: string;
  startDate: string | null;
  endDate: string | null;
  dayCount: number;
  nights: number | null;
  cities: string[];
  stopCount: number;
  /** Straight lines between each day's stops, added up. Null when too few stops have a pin. */
  km: number | null;
  /** The whole trip's stops joined in order, with its cities named: drawn for a trip through several. */
  route: Sketch | null;
  days: StoryDay[];
  /** Days past the ones that get a slide. */
  moreDays: number;
  guess: StoryGuess | null;
}

export interface StorySource {
  title?: string | null;
  trip_meta?: unknown;
  start_date?: string | null;
  end_date?: string | null;
  itinerary?: unknown;
}

/** A day past this gets no slide of its own: a two-week trip told day by day is a long sit. */
export const STORY_DAY_SLIDES = 7;
const STOPS_NAMED = 3;
/** The drawings' boxes: the screen scales them. */
export const ROUTE_BOX = { width: 320, height: 300, padding: 30 };
export const DAY_ROUTE_BOX = { width: 300, height: 190, padding: 22 };

const REGION_BY_ZONE: Record<string, StoryRegion> = {
  Europe: "europe",
  Asia: "asia",
  Africa: "africa",
  America: "americas",
  Australia: "oceania",
  Pacific: "oceania",
  Atlantic: "atlantic",
  Indian: "indian",
};

const CONTINENTS_OF: Record<StoryRegion, Continent[]> = {
  europe: ["europe"],
  asia: ["asia", "middle-east"],
  africa: ["africa"],
  americas: ["americas"],
  oceania: ["oceania"],
  atlantic: [],
  indian: [],
};

const OUTDOORS = new Set(["nature", "park", "beach", "adventure"]);

type RawActivity = {
  name?: unknown;
  type?: unknown;
  transport_mode?: unknown;
  coordinates?: { lat?: unknown; lng?: unknown } | null;
};
type RawDay = { day_number: number; date: string | null; city: string | null; title: string | null; activities: RawActivity[] };

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function readDays(itinerary: unknown): RawDay[] {
  if (!Array.isArray(itinerary)) return [];
  return itinerary
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      day_number: Number(d.day_number),
      date: str(d.date) || null,
      city: str(d.city) || null,
      title: str(d.title) || str(d.theme) || null,
      activities: (Array.isArray(d.activities) ? d.activities : []).filter(
        (a): a is RawActivity => !!a && typeof a === "object"
      ),
    }))
    .filter((d) => Number.isFinite(d.day_number))
    .sort((a, b) => a.day_number - b.day_number);
}

/** What the day is busy with: not the hotel, not the ride to the next city. */
function dayStops(day: RawDay): RawActivity[] {
  return day.activities.filter((a) => {
    const shape = { type: str(a.type) || null, name: str(a.name) || null, transport_mode: str(a.transport_mode) || null };
    return str(a.name) !== "" && isDayStop(shape) && !isRide(shape);
  });
}

const isMeal = (a: RawActivity) => isMealStop({ type: str(a.type) });
const isOutdoors = (a: RawActivity) => OUTDOORS.has(normalizeActivityType(a.type, a.name));

function storyDay(day: RawDay): StoryDay {
  const stops = dayStops(day);
  // Sights lead: a friend recognises a trip by what is seen there, not by where lunch is.
  const named = [...stops.filter((a) => !isMeal(a)), ...stops.filter(isMeal)].slice(0, STOPS_NAMED).map((a) => str(a.name));
  const drawn = routeSketch([{ day_number: day.day_number, activities: stops }], DAY_ROUTE_BOX);
  return {
    day: day.day_number,
    date: day.date,
    city: day.city,
    title: day.title,
    stops: named,
    more: stops.length - named.length,
    route: drawn && drawn.points.length >= 2 ? drawn : null,
  };
}

function nightsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  return Number.isNaN(from) || Number.isNaN(to) || to < from ? null : Math.round((to - from) / 86_400_000);
}

function kmBetweenStops(days: RawDay[]): number | null {
  let km = 0;
  let legs = 0;
  for (const day of days) {
    const pins = dayStops(day)
      .map((a) => a.coordinates as { lat?: number | null; lng?: number | null } | null | undefined)
      .filter(isRealPoint);
    for (let i = 1; i < pins.length; i += 1) {
      km += haversineKm({ lat: pins[i - 1].lat, lng: pins[i - 1].lng }, { lat: pins[i].lat, lng: pins[i].lng });
      legs += 1;
    }
  }
  return legs >= 2 && km >= 1 ? Math.round(km) : null;
}

/** Names compared without accents, case or punctuation: "São Paulo" is "sao paulo". */
export function plainName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function regionOf(meta: Record<string, unknown> | null): StoryRegion | null {
  const zone = str(meta?.timezone);
  return REGION_BY_ZONE[zone.split("/")[0]] ?? null;
}

// A guess is offered for one place with a name short enough to be an answer.
const GUESSABLE = /^\p{L}[\p{L} .'’-]{2,17}$/u;

/** A small, repeatable shuffle: the same link shows everyone the same four answers in the same order. */
function seededOrder(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildGuess(input: {
  place: string;
  region: StoryRegion | null;
  dayCount: number;
  startDate: string | null;
  days: RawDay[];
  locale: Locale;
  seed: string;
  /** The trip's country, when it stores one. */
  countryCode: string | null;
}): { guess: StoryGuess; place: string } | null {
  // A place we have a page for is shown by its name in the reader's language.
  const known = destinations.find((d) => Object.values(d.name).some((n) => plainName(n) === plainName(input.place)));
  const place = known ? known.name[input.locale] : input.place;
  if (!GUESSABLE.test(place)) return null;

  const next = seededOrder(input.seed);
  // A place we have no page for may be a country or a region: a city inside it would be a second right answer.
  const within = known ? null : input.countryCode;
  const others = destinations.filter(
    (d) => d !== known && plainName(d.name[input.locale]) !== plainName(place) && d.countryCode.toUpperCase() !== within
  );
  const near = input.region ? CONTINENTS_OF[input.region] : [];
  // Wrong answers from the same part of the world first: the first clue names it.
  const pool = [...shuffled(others.filter((d) => near.includes(d.continent)), next), ...shuffled(others.filter((d) => !near.includes(d.continent)), next)];
  const decoys = pool.slice(0, 3).map((d) => d.name[input.locale]);
  if (decoys.length < 3) return null;
  const options = shuffled([place, ...decoys], next);

  const stops = input.days.flatMap(dayStops);
  const meals = stops.filter(isMeal).length;
  const outdoors = stops.filter((a) => !isMeal(a) && isOutdoors(a)).length;
  const sights = stops.length - meals - outdoors;
  const month = input.startDate && /^\d{4}-\d{2}-\d{2}/.test(input.startDate) ? Number(input.startDate.slice(5, 7)) : null;
  const letters = [...place].filter((ch) => /\p{L}/u.test(ch));

  const clues: StoryClue[] = [{ kind: "when", days: input.dayCount, month: month && month >= 1 && month <= 12 ? month : null, region: input.region }];
  if (stops.length > 0) clues.push({ kind: "mix", sights, meals, outdoors });
  clues.push({ kind: "letters", first: letters[0].toLocaleUpperCase(input.locale), letters: letters.length, words: place.trim().split(/\s+/).length });

  return { guess: { clues, options, answer: options.indexOf(place) }, place };
}

/**
 * The story of a stored trip, for a reader in `locale`. `seed` fixes the order of the guess's answers:
 * the share token, so the link shows everyone the same four.
 */
export function buildTripStory(trip: StorySource, locale: Locale, seed: string): TripStory {
  const meta = trip.trip_meta && typeof trip.trip_meta === "object" ? (trip.trip_meta as Record<string, unknown>) : null;
  const destination = getTripDestination({ title: trip.title, trip_meta: trip.trip_meta });
  const days = readDays(trip.itinerary);
  const cities = [...new Set(days.map((d) => d.city).filter((c): c is string => !!c))];
  const startDate = str(trip.start_date) || days[0]?.date || null;
  const endDate = str(trip.end_date) || days[days.length - 1]?.date || null;
  const shortName = destination.split(",")[0].trim();

  const guessed =
    cities.length <= 1 && days.length > 0
      ? buildGuess({
          place: shortName,
          region: regionOf(meta),
          dayCount: days.length,
          startDate,
          days,
          locale,
          seed,
          countryCode: str(meta?.country_code).toUpperCase() || null,
        })
      : null;

  return {
    place: guessed?.place ?? (cities.length > 1 ? destination : shortName),
    destination,
    startDate,
    endDate,
    dayCount: days.length,
    nights: nightsBetween(startDate, endDate),
    cities,
    stopCount: days.reduce((sum, d) => sum + dayStops(d).length, 0),
    km: kmBetweenStops(days),
    route: routeSketch(days, ROUTE_BOX),
    days: days.slice(0, STORY_DAY_SLIDES).map(storyDay),
    moreDays: Math.max(0, days.length - STORY_DAY_SLIDES),
    guess: guessed?.guess ?? null,
  };
}
