/**
 * Places travellers already kept for a destination, offered to the model as
 * the first places to build a new plan from: the ones that fit the trip's
 * vibes, budget, style and pace, named the way earlier plans named them.
 * public.known_places holds them (supabase/migrations/…_known_places.sql),
 * rebuilt daily from saved trips and cached plans.
 */
import { cacheAdminDb } from "@/lib/supabase/cache-admin";
import { normalizeActivityType, type ActivityType } from "@/lib/trip/activity-type";
import { PACE_BUDGETS, normalizePace } from "@/lib/trip/pace";
import type { TripCreationParams, TripVibe } from "@/types";
import { destinationKey, foldText } from "./destination-key";
import type { SupportedLanguage } from "./language";

/** A place earlier plans for a destination had, as public.known_places holds it. */
export interface KnownPlaceRow {
  destination: string;
  place_key: string;
  name: string;
  type: string | null;
  tier: string | null;
  users: number;
  plans: number;
  vibes: Record<string, number> | null;
}

/** A place offered to the model. */
export interface KnownPlace {
  name: string;
  type: ActivityType;
}

// A slow read never holds up a plan: it is then made without known places.
const LOAD_TIMEOUT_MS = 1500;
const MAX_PLACES = 20;

const MEALS = new Set<ActivityType>(["restaurant", "cafe", "bar", "food"]);
// What each vibe looks like as a place, for places whose trips said little.
const VIBE_TYPES: Partial<Record<TripVibe, ActivityType[]>> = {
  foodie: ["restaurant", "cafe", "bar", "food", "market"],
  cultural: ["museum", "landmark", "attraction", "tour", "entertainment"],
  nature: ["park", "nature", "beach"],
  adventure: ["activity", "nature", "tour", "beach"],
  urban: ["shopping", "nightlife", "bar", "market", "attraction", "entertainment"],
  romantic: ["park", "landmark", "restaurant", "bar", "beach", "attraction"],
  wellness: ["spa", "park", "nature", "beach"],
};
// Vibes whose places are particular: only places their trips had will do.
const PARTICULAR = new Set<TripVibe>(["wonderland", "movie-magic", "fairytale", "retro"]);
const VIBE_WEIGHTS = [0.5, 0.3, 0.2];

// Not places to build a day from.
const NOT_A_PLACE = /^(check[- ]?(in|out)|departure|arrival|transfer|free time|rest\b|hotel\b)/;
// "Dinner in Ginza" names an area, not a place.
const MEAL_IN_AN_AREA = /^(breakfast|brunch|lunch|dinner|supper|drinks)( (and|&) drinks)? (in|around|near)\b/;
// "Dinner at Le Consulat" is Le Consulat.
const MEAL_AT = /^(breakfast|brunch|lunch|dinner|supper|drinks|coffee|aperitivo|pranzo|cena|colazione|almuerzo|desayuno|almoco|jantar) (at|al|alla|allo|da|presso|en|em|no|na) /;

const STOP_WORDS = new Set(
  "the of de du des la le les el los las del di da dei della delle dos das do and et y e at in a al alla l d".split(" ")
);
const KIND_WORDS = new Set(
  (
    "museum musee museo museu gallery garden gardens jardin jardins jardim giardino giardini park parc parco parque " +
    "basilica cathedral cattedrale catedral church chiesa iglesia igreja eglise temple tempio templo shrine " +
    "palace palazzo palacio palais market marche mercado mercato castle castello castillo castelo chateau tower torre " +
    "bridge ponte puente square plaza piazza praca district quarter quartier street exploration explore visit walk tour"
  ).split(" ")
);

type Band = "free" | "budget" | "moderate" | "premium";
const BANDS: Array<[RegExp, Band]> = [
  [/^(free|gratis|gratuit[oa]|none|included|incluso|incluido|0)$/, "free"],
  [/^(budget|low|cheap|basso|bajo|baixo|economico)$/, "budget"],
  [/^(moderate|moderato|moderado|medium|mid|balanced|medio)$/, "moderate"],
  [/^(premium|high|expensive|luxury|alto|caro|lusso|lujo|luxo)$/, "premium"],
];
function band(tier: string | null): Band | null {
  const word = foldText(tier ?? "");
  return BANDS.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

/** The words that tell a place from another: "Musée du Louvre" and "Louvre Museum" are both "louvre". */
function coreWords(name: string): string[] {
  const words = foldText(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(MEAL_AT, "")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w));
  const own = words.filter((w) => !KIND_WORDS.has(w));
  return own.length ? own : words;
}

/** The names a name gives in brackets: "Ubud Monkey Forest (Sacred Monkey Forest Sanctuary)". */
function otherNames(name: string): string[][] {
  return [...name.matchAll(/\(([^)]*)\)/g)].map((m) => coreWords(m[1])).filter((core) => core.length > 0);
}

/** The same word, or a long one a letter apart: "Tegalalang" and "Tegallalang", "Terrace" and "Terraces". */
function alike(x: string, y: string): boolean {
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 5 || Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (x[i] === y[i]) i++;
  return x.slice(i + 1) === y.slice(i + 1) || x.slice(i + 1) === y.slice(i) || x.slice(i) === y.slice(i + 1);
}

function samePlace(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (a.join("") === b.join("")) return true;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const inBig = (w: string) => big.some((x) => alike(x, w));
  // "Sacré-Cœur Basilica" is in "Montmartre & Sacré-Cœur"; "Shibuya" alone is
  // too little to say "Shibuya Sky" is it.
  return (small.length === big.length || small.length >= 2) && small.every(inBig);
}

/** By its name, or by a name one of them gives in brackets. */
function sameAs(a: { core: string[]; alts: string[][] }, b: { core: string[]; alts: string[][] }): boolean {
  return (
    samePlace(a.core, b.core) || a.alts.some((alt) => samePlace(alt, b.core)) || b.alts.some((alt) => samePlace(a.core, alt))
  );
}

/**
 * The rows for this destination and not a namesake: "Valencia, Venezuela"
 * never gets Valencia's places in Spain. A destination written without its
 * country is its best-known namesake.
 */
export function rowsForDestination(rows: KnownPlaceRow[], destination: string): KnownPlaceRow[] {
  const want = destinationKey(destination);
  const same = rows
    .map((row) => ({ row, key: destinationKey(row.destination) }))
    .filter(({ key }) => key.city === want.city);
  const weight = new Map<string, number>();
  for (const { row, key } of same) {
    if (key.country) weight.set(key.country, (weight.get(key.country) ?? 0) + row.users * 3 + row.plans);
  }
  const usual = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const country = want.country ?? usual;
  return same
    .filter(({ key }) => key.country === country || (key.country === null && country === usual))
    .map(({ row }) => row);
}

interface Place {
  name: string;
  type: ActivityType;
  band: Band | null;
  users: number;
  plans: number;
  vibes: Map<string, number>;
  core: string[];
  alts: string[][];
  // How strongly the chosen name and type are backed.
  backing: number;
}

/** One place per place: its spellings and the destination's spellings merged. */
function mergePlaces(rows: KnownPlaceRow[]): Place[] {
  const byKey = new Map<string, Place>();
  for (const row of rows) {
    const backing = row.users * 3 + row.plans;
    const place = byKey.get(row.place_key);
    if (!place) {
      byKey.set(row.place_key, {
        name: row.name,
        type: normalizeActivityType(row.type, row.name),
        band: band(row.tier),
        users: row.users,
        plans: row.plans,
        vibes: new Map(Object.entries(row.vibes ?? {})),
        core: coreWords(row.name),
        alts: otherNames(row.name),
        backing,
      });
      continue;
    }
    place.users += row.users;
    place.plans += row.plans;
    for (const [vibe, n] of Object.entries(row.vibes ?? {})) place.vibes.set(vibe, (place.vibes.get(vibe) ?? 0) + n);
    if (backing > place.backing) {
      Object.assign(place, {
        name: row.name,
        type: normalizeActivityType(row.type, row.name),
        band: band(row.tier),
        core: coreWords(row.name),
        alts: otherNames(row.name),
        backing,
      });
    }
  }

  const kept: Place[] = [];
  const byBacking = [...byKey.values()].sort((a, b) => b.users * 3 + b.plans - (a.users * 3 + a.plans));
  for (const place of byBacking) {
    const twin = kept.find((k) => sameAs(k, place));
    if (!twin) {
      kept.push(place);
      continue;
    }
    twin.users += place.users;
    twin.plans += place.plans;
    for (const [vibe, n] of place.vibes) twin.vibes.set(vibe, (twin.vibes.get(vibe) ?? 0) + n);
  }
  return kept;
}

/** Whether the place's price suits the trip: a premium trip's meals are no cheap eats, a budget trip has nothing premium. */
function suitsBudget(place: Place, params: TripCreationParams): boolean {
  if (!place.band) return true;
  const meal = MEALS.has(place.type);
  if (params.budgetTier === "budget" || params.travelStyle === "backpacker") {
    return place.band !== "premium" && !(meal && place.band === "moderate");
  }
  if (params.budgetTier === "premium") return !(meal && (place.band === "free" || place.band === "budget"));
  return !(meal && place.band === "premium");
}

/** How well the place fits the trip's vibes, 0 to 1: what its trips' vibes were, then what kind of place it is. */
function vibeFit(place: Place, vibes: TripVibe[]): number {
  if (!vibes.length) return 1;
  const sources = Math.max(1, place.users + place.plans);
  let fit = 0;
  let weights = 0;
  vibes.forEach((vibe, i) => {
    const weight = VIBE_WEIGHTS[i] ?? 0.2;
    const evidence = Math.min(1, (place.vibes.get(vibe) ?? 0) / sources);
    const looksLike = VIBE_TYPES[vibe]?.includes(place.type) ? 1 : 0;
    fit += weight * (0.6 * evidence + 0.4 * looksLike);
    weights += weight;
  });
  return fit / weights;
}

/**
 * The known places for this trip, best first: those that suit its vibes,
 * budget and style, none it already asks for by name, about half of what its
 * pace fills the days with, and at most one known meal a day.
 */
export function pickKnownPlaces(rows: KnownPlaceRow[], params: TripCreationParams, totalDays: number): KnownPlace[] {
  const vibes = params.vibes ?? [];
  // Hidden gems are what popular places are not.
  if (vibes[0] === "offbeat") return [];

  const perDay = PACE_BUDGETS[normalizePace(params.pace)].targetActivities;
  let limit = Math.min(MAX_PLACES, Math.max(4, Math.round(totalDays * perDay * 0.5)));
  if (vibes.includes("offbeat")) limit = Math.round(limit / 2);
  const mealLimit = Math.max(1, Math.min(totalDays, Math.floor(limit * 0.4)));
  const wished = (params.mustDos ?? []).map(coreWords);

  const scored = mergePlaces(rows)
    .filter((place) => {
      const name = foldText(place.name);
      if (place.type === "transport" || place.type === "accommodation") return false;
      if (NOT_A_PLACE.test(name) || MEAL_IN_AN_AREA.test(name) || place.name.length > 70) return false;
      if (wished.some((wish) => wish.some((w) => w.length >= 4 && place.core.includes(w)))) return false;
      if (PARTICULAR.has(vibes[0]) && !place.vibes.get(vibes[0])) return false;
      return suitsBudget(place, params);
    })
    .map((place) => ({ place, fit: vibeFit(place, vibes) }))
    .filter(({ fit }) => fit >= 0.15)
    .map(({ place, fit }) => ({ place, score: Math.log2(2 + place.users * 3 + place.plans) * (0.3 + fit) }))
    .sort((a, b) => b.score - a.score);

  const picked: KnownPlace[] = [];
  let meals = 0;
  for (const { place } of scored) {
    if (picked.length >= limit) break;
    if (MEALS.has(place.type)) {
      if (meals >= mealLimit) continue;
      meals++;
    }
    picked.push({ name: place.name, type: place.type });
  }
  // Two places are no starting point.
  return picked.length >= 3 ? picked : [];
}

/** The destination's rows in the plan's language, or none when they can't be had quickly. */
export async function loadKnownPlaces(destination: string, language: SupportedLanguage): Promise<KnownPlaceRow[]> {
  const db = cacheAdminDb();
  const first = foldText(destination.split(",")[0] ?? "");
  if (!db || !first) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      db
        .from("known_places")
        .select("destination, place_key, name, type, tier, users, plans, vibes")
        .eq("destination_first", first)
        .eq("language", language)
        .limit(500),
      timeout,
    ]);
    if (!result || result.error) return [];
    return (result.data ?? []) as KnownPlaceRow[];
  } finally {
    clearTimeout(timer);
  }
}

/** The known places for a trip; none when there are too few or the read fails. */
export async function knownPlacesFor(
  params: TripCreationParams,
  totalDays: number,
  language: SupportedLanguage
): Promise<KnownPlace[]> {
  try {
    const rows = await loadKnownPlaces(params.destination, language);
    return pickKnownPlaces(rowsForDestination(rows, params.destination), params, totalDays);
  } catch (err) {
    console.warn("[known-places] unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** How many of a plan's activities are known places it was offered. */
export function knownPlacesUsed(days: Array<{ activities?: Array<{ name?: string }> }>, places: KnownPlace[]): number {
  const names = (name: string) => ({ core: coreWords(name), alts: otherNames(name) });
  const offered = places.map((p) => names(p.name));
  let used = 0;
  for (const day of days) {
    for (const activity of day.activities ?? []) {
      if (!activity.name) continue;
      const planned = names(activity.name);
      if (offered.some((place) => sameAs(place, planned))) used++;
    }
  }
  return used;
}
