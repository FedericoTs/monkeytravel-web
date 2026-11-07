import { QUESTIONS, type Home, type Person } from "./questions";

/**
 * How answers become a place. A plain score, no model and no data about the
 * person beyond the answers in the link, so the same link always gives the same
 * result. Each answer adds points for what a place offers, and the ranking is
 * across everyone in the link, which is what makes "where would we go together"
 * possible.
 */
export interface MatchPlace {
  slug: string;
  continent: string;
  budgetLevel: 1 | 2 | 3;
  bestMonths: readonly number[];
  tags: readonly string[];
  stayDays: number;
}

type Weights = Readonly<Record<string, number>>;

const MORNING: readonly Weights[] = [
  { beach: 3, wellness: 1, nature: 1 },
  { historical: 3, cultural: 2, romantic: 1 },
  { foodie: 3, offbeat: 1, urban: 1 },
  { adventure: 3, nature: 3 },
];

const EVENING: readonly Weights[] = [
  { romantic: 2, foodie: 2 },
  { nightlife: 3, urban: 1 },
  { urban: 2, shopping: 1, luxury: 1 },
  { nature: 2, wellness: 2 },
];

const WHO: readonly Weights[] = [
  { offbeat: 1, urban: 1, cultural: 1 },
  { romantic: 3 },
  { nightlife: 2, foodie: 1, beach: 1 },
  { nature: 1, beach: 1, cultural: 1, nightlife: -2, romantic: -1 },
];

const SEASON_MONTHS: readonly (readonly number[])[] = [[3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 1, 2], []];

/** Points by budget answer (row) and the place's cost level (column). */
const BUDGET_FIT: readonly (readonly number[])[] = [
  [3, 1, -2],
  [1, 2, 0],
  [-1, 1, 3],
];

const HOME_CONTINENT: Record<Home, string | null> = { e: "europe", a: "asia", m: "americas", f: "africa", o: "oceania", x: null };

/** Places a short flight from a continent they aren't on. */
const SHORT_HOPS: Readonly<Record<string, readonly string[]>> = {
  europe: ["marrakech"],
};

function taste(tags: readonly string[], weights: Weights): number {
  return tags.reduce((sum, tag) => sum + (weights[tag] ?? 0), 0);
}

/** Whether a place has what the answer is mainly about, not just something near it. */
function offers(tags: readonly string[], weights: Weights): boolean {
  const main = Math.max(...Object.values(weights));
  return tags.some((tag) => weights[tag] === main);
}

const positive = (weights: Weights) => Object.values(weights).reduce((sum, weight) => sum + Math.max(weight, 0), 0);

function seasonFit(place: MatchPlace, when: number): number {
  const months = SEASON_MONTHS[when];
  if (months.length === 0) return 0;
  const overlap = place.bestMonths.filter((month) => months.includes(month)).length;
  return overlap === 0 ? -3 : overlap === 1 ? 1 : 3;
}

function distanceFit(place: MatchPlace, far: number, home: Home): number {
  const continent = HOME_CONTINENT[home];
  if (!continent || far === 2) return 0;
  const same = place.continent === continent;
  if (far === 1) return same ? -1 : 2;
  if (same) return 4;
  return SHORT_HOPS[continent]?.includes(place.slug) ? 2 : -2;
}

export function placeScore(place: MatchPlace, { answers, home }: Person): number {
  const [morning, evening, when, budget, who, far] = answers;
  return (
    taste(place.tags, MORNING[morning]) +
    taste(place.tags, EVENING[evening]) +
    taste(place.tags, WHO[who]) +
    seasonFit(place, when) +
    BUDGET_FIT[budget][place.budgetLevel - 1] +
    distanceFit(place, far, home)
  );
}

/** The score of a place that fits every answer perfectly. */
function bestScore({ answers, home }: Person): number {
  const [morning, evening, when, , who, far] = answers;
  const distance = !HOME_CONTINENT[home] || far === 2 ? 0 : far === 0 ? 4 : 2;
  return positive(MORNING[morning]) + positive(EVENING[evening]) + positive(WHO[who]) + (SEASON_MONTHS[when].length ? 3 : 0) + 3 + distance;
}

const fit = (place: MatchPlace, person: Person) => Math.max(placeScore(place, person), 0) / bestScore(person);

/** A fit from 0 to 1 as the match shown to the person. */
const toPercent = (share: number) => Math.round(58 + 41 * share);

function hash(text: string): number {
  let h = 5381;
  for (const char of text) h = (h * 33) ^ char.charCodeAt(0);
  return h >>> 0;
}

export interface Match {
  place: MatchPlace;
  percent: number;
}

/**
 * Every place, best first, for everyone in the link. Ties are settled by the
 * link itself, so a tie doesn't always go to the same place and the same link
 * never changes its answer.
 */
export function rankPlaces(places: readonly MatchPlace[], people: readonly Person[]): Match[] {
  const seed = people.map((person) => person.answers.join("") + person.home).join("|");
  return places
    .map((place) => {
      const share = people.reduce((sum, person) => sum + fit(place, person), 0) / people.length;
      return { place, share, tie: hash(`${seed}:${place.slug}`) };
    })
    .sort((a, b) => b.share - a.share || a.tie - b.tie)
    .map(({ place, share }) => ({ place, percent: toPercent(share) }));
}

export const TRAVEL_TYPES = ["slowRomantic", "oldSoul", "tableHunter", "nightOwl", "saltSeeker", "trailChaser", "neonWanderer", "wildCard"] as const;
export type TravelType = (typeof TRAVEL_TYPES)[number];

/** By first morning (row) and that evening (column). */
const TYPE_OF: readonly (readonly TravelType[])[] = [
  ["slowRomantic", "saltSeeker", "saltSeeker", "saltSeeker"],
  ["slowRomantic", "nightOwl", "neonWanderer", "oldSoul"],
  ["tableHunter", "nightOwl", "neonWanderer", "tableHunter"],
  ["trailChaser", "wildCard", "wildCard", "trailChaser"],
];

export function travelType({ answers }: Person): TravelType {
  return TYPE_OF[answers[0]][answers[1]];
}

/**
 * Why this place, as keys of `why.*` in the messages, strongest first. Only what
 * the place really offers: a city without a beach never gets the swimming line.
 */
export function whyKeys(place: MatchPlace, person: Person, limit = 3): string[] {
  const [morning, evening, when, budget, , far] = person.answers;
  const option = (question: number, answer: number) => QUESTIONS[question].options[answer];
  const keys: string[] = [];
  if (offers(place.tags, MORNING[morning])) keys.push(`morning.${option(0, morning)}`);
  if (offers(place.tags, EVENING[evening])) keys.push(`evening.${option(1, evening)}`);
  if (seasonFit(place, when) === 3) keys.push(`when.${option(2, when)}`);
  if (BUDGET_FIT[budget][place.budgetLevel - 1] >= 2) keys.push(`budget.${option(3, budget)}`);
  if (distanceFit(place, far, person.home) >= 2) keys.push(`far.${option(5, far)}`);
  return keys.slice(0, limit);
}

const MORNING_VIBE = ["nature", "cultural", "foodie", "adventure"];
const EVENING_VIBE = ["romantic", "urban", "urban", "nature"];
const BUDGET_TIER = ["budget", "balanced", "premium"];

/** The planner link that starts this place with these answers already in. */
export function planHref(place: MatchPlace, person: Person, together = false): string {
  const [morning, evening, , budget, who] = person.answers;
  const vibes = [...new Set([MORNING_VIBE[morning], EVENING_VIBE[evening]])];
  const params = new URLSearchParams({
    destination: place.slug,
    days: String(place.stayDays),
    budget: BUDGET_TIER[budget],
    vibes: vibes.join(","),
    from: "match",
  });
  const intent = together || who === 2 ? "group" : who === 0 ? "solo" : null;
  if (intent) params.set("who", intent);
  return `/trips/new?${params.toString()}`;
}
