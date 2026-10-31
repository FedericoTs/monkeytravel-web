/**
 * A diet plan's places to eat, looked up on Google Maps before the plan is
 * shown. The model names them from memory, and the small places a diet sends
 * it to close and move more often than the sights it knows. In place of one
 * Maps has as closed, or doesn't have, the model offers a few others, and the
 * first Maps has open takes its place; when none is, it leaves the plan.
 *
 * Nothing Google answers is kept or shown: the lookup only decides which of
 * the model's places stay.
 */
import { logApiCall } from "@/lib/api-gateway";
import { placesCostForCall } from "@/lib/api-gateway/places-sku";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import type { SupportedLanguage } from "@/lib/ai/language";
import { withActivityDefaults } from "@/lib/ai/server-fields";
import { replacementOptions } from "@/lib/gemini";
import { bareName, distanceM, isKind, nameTokens, nameVariants } from "@/lib/images/wikimedia-landmark";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { isPlaceholderPoint } from "@/lib/trip/placeholder-point";
import type { Activity, ItineraryDay } from "@/types";

// Pro fields (lib/api-gateway/places-sku.ts): the name and types tell the
// plan's place from another, the status says whether it is open.
const FIELD_MASK = "places.displayName,places.businessStatus,places.location,places.types";
// A request costs the same for one place or five, and a chain's other
// branches or a namesake can come first.
const RESULTS = 5;
// The search keeps within this of the activity's own point.
const BIAS_M = 25_000;
// A place by the name farther than this from the point is another: a namesake
// in another town, or a branch across it. Wider than the model's points stray.
const NEAR_M = 5_000;
// Of a chain's branches, the plan means the one at its address: a branch this
// near its point. As near, a name that shares only a word with the plan's is
// the plan's place.
const HERE_M = 1_000;
const SEARCH_TIMEOUT_MS = 5_000;
// Searches one plan may make, its tries at new places included. A long
// trip's later meals go unchecked, and a new place past it unlooked-up.
const MAX_SEARCHES = 30;
// Places the model offers at once in place of one that is not open, and
// times it is asked when none of them is.
const OPTIONS = 4;
const ROUNDS = 2;

// Meals and drinks, as in lib/images/activity.ts.
const MEAL_TYPES = new Set(["restaurant", "cafe", "bar", "food"]);
// A tour, a class or a picnic is not one place Maps could know.
const NOT_ONE_PLACE = new Set(
  "tour tours class classes crawl walk walks picnic workshop tasting tastings cooking experience experiences corso lezione degustazione esperienza clase clases taller degustacion experiencia aula passeio piquenique degustacao"
    .split(" "),
);
// Words a meal's name has besides its place's: "Vegan lunch at Legumi",
// "Almuerzo en Casa Lucio".
const OTHER_WORDS = new Set(
  "breakfast brunch lunch dinner supper colazione pranzo cena desayuno almuerzo almoco jantar en em no na nel nella presso chez bei im"
    .split(" "),
);
// Google's types of a place to eat or drink: "food" on most, a kind of
// restaurant, café, bar or food shop on the rest.
const EATS =
  /^(food|restaurant|cafe|cafeteria|bar|pub|bakery|bistro|diner|deli|food_court|meal_takeaway|meal_delivery|confectionery|.+_(restaurant|cafe|bar|pub)|(coffee|pastry|dessert|ice_cream|sandwich|donut|bagel|juice|acai|chocolate)_shop|(tea|steak)_house)$/;
const CLOSED = new Set(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]);

/** A place a search found, as far as the check reads it. */
export interface FoundPlace {
  displayName?: { text?: string };
  businessStatus?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
}

type Point = { lat: number; lng: number };
type Named = Pick<Activity, "name"> & Partial<Pick<Activity, "location" | "address" | "coordinates">>;

const plainWords = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether an activity is a place to eat or drink that Maps could know. */
export function isPlaceToEat(activity: Partial<Activity>): boolean {
  if (!activity.name || !MEAL_TYPES.has(normalizeActivityType(activity.type ?? "", activity.name))) return false;
  return !plainWords(activity.name).some((w) => NOT_ONE_PLACE.has(w));
}

/** The activity's own point; none when it has none, or the placeholder of a missing one. */
function pointOf(activity: Partial<Activity>): Point | null {
  const c = activity.coordinates;
  if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") return null;
  if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180 || (c.lat === 0 && c.lng === 0)) return null;
  return isPlaceholderPoint(c.lat, c.lng) ? null : { lat: c.lat, lng: c.lng };
}

// What a meal's name says before its place: "Local vegan lunch at", "Pranzo da".
const MEAL_PHRASE =
  /^.*?\b(?:breakfast|brunch|lunch|dinner|supper|drinks|coffee|colazione|pranzo|cena|aperitivo|desayuno|almuerzo|almoço|jantar|lanche)\s+(?:at|in|da|al|alla|presso|en|em|no|na)\s+/iu;

/** The name to search for: "Lunch at" and what brackets add left out. */
const searchName = (name: string) =>
  bareName(name).replace(MEAL_PHRASE, "").replace(/\s*\([^)]*\)/g, "").trim() || name;

/** A name's own words: no kinds of place ("restaurant", "café"), no meal words, none of `besides`. */
const ownWords = (name: string, besides?: Set<string>) =>
  nameTokens(name).filter((t) => !isKind(t) && !OTHER_WORDS.has(t) && !besides?.has(t));

/**
 * 2 for two names spelled alike, or the shorter's words all in the longer's
 * when they are enough to name a place: two words, or one long word of the
 * plan's ("Padella" in "Padella Borough"). 1 for Google's name one word of the
 * plan's: "Trattoria Da Enzo" for "Da Enzo al 29", but "A Casa do Paladar" for
 * "Paladar da Prata" too. 0 for another name.
 */
function wordsAgree(ours: string[], theirs: string[]): 0 | 1 | 2 {
  if (ours.join("").length >= 5 && ours.join("") === theirs.join("")) return 2;
  const [short, long] = ours.length <= theirs.length ? [ours, theirs] : [theirs, ours];
  if (short.length === 0 || !short.every((t) => long.includes(t))) return 0;
  if (short.length === long.length || short.length >= 2 || (short === ours && short[0].length >= 6)) return 2;
  return short === theirs ? 1 : 0;
}

/**
 * How surely Google's name names the activity's place: 2 for the same name, 1
 * for one word in common (the same place only where the plan puts it), 0 for
 * another. Google's is taken whole and in its parts ("Kong - Food Made With
 * Compassion"), and without the words of where the plan puts the place: Google
 * names a branch by its street, quarter or town ("Padella Borough Market",
 * "Mama Eat Roma").
 */
export function nameAgreement(activity: Named, google: string): 0 | 1 | 2 {
  const named = new Set(nameTokens(activity.name));
  const where = new Set(
    [activity.location, activity.address].flatMap((s) => (s ? nameTokens(s) : [])).filter((t) => !named.has(t)),
  );
  const ours = nameVariants([activity.name, searchName(activity.name)], true).map((v) => ownWords(v));
  const theirs = [google, ...google.split(/\s+[|–—-]\s+|\s*[|,()]\s*/)].map((v) => ownWords(v, where));
  let best: 0 | 1 | 2 = 0;
  for (const a of ours) for (const b of theirs) best = Math.max(best, wordsAgree(a, b)) as 0 | 1 | 2;
  return best;
}

/** Whether two of the plan's names are one place: "Ao 26 - Vegan Food Project" and "Vegan lunch at Ao 26". */
const samePlace = (a: string, b: string) => nameAgreement({ name: a }, b) === 2 || nameAgreement({ name: b }, a) === 2;

/**
 * What Maps says of an activity's place, from what a search for it found:
 * open, closed, or missing (no place to eat by that name near it). Of a
 * chain's branches, only one near the activity's point counts: another open
 * across town doesn't open the one the plan sends the traveller to.
 */
export function placeStatus(activity: Named, places: FoundPlace[]): "open" | "closed" | "missing" {
  const point = pointOf(activity);
  /** Metres from the activity's point; null when either has none. */
  const metres = (p: FoundPlace) =>
    point && typeof p.location?.latitude === "number" && typeof p.location.longitude === "number"
      ? distanceM(point.lat, point.lng, p.location.latitude, p.location.longitude)
      : null;
  const named = places.filter((p) => {
    if (!p.displayName?.text || !(p.types ?? []).some((t) => EATS.test(t))) return false;
    const m = metres(p);
    const agreement = nameAgreement(activity, p.displayName.text);
    return agreement === 2 || (agreement === 1 && m !== null && m <= HERE_M);
  });
  // Several by the name are a chain's branches, and the plan means the one at its point.
  const reach = named.length > 1 ? HERE_M : NEAR_M;
  const here = named.filter((p) => (metres(p) ?? 0) <= reach);
  if (here.length === 0) return "missing";
  return here.some((p) => !CLOSED.has(p.businessStatus ?? "")) ? "open" : "closed";
}

/** Google's places for a query, near the point when there is one; null when the search failed. */
async function searchPlaces(key: string, textQuery: string, near: Point | null): Promise<FoundPlace[] | null> {
  for (let attempt = 0; ; attempt++) {
    const startedAt = Date.now();
    let httpStatus = 0;
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
        body: JSON.stringify({
          textQuery,
          maxResultCount: RESULTS,
          ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_M } } } : {}),
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      httpStatus = response.status;
      if (!response.ok) return null;
      const places = ((await response.json()) as { places?: FoundPlace[] }).places ?? [];
      // Google now and then answers a place it knows with nothing: asked again, it finds it.
      if (places.length > 0 || attempt > 0) return places;
    } catch {
      return null;
    } finally {
      void logApiCall({
        apiName: "google_places_search",
        endpoint: "places:searchText (place to eat)",
        status: httpStatus || 500,
        responseTimeMs: Date.now() - startedAt,
        cacheHit: false,
        costUsd: placesCostForCall({ kind: "textSearch", fieldMask: FIELD_MASK }).usd,
        exactCost: true,
      });
    }
  }
}

export interface PlacesToEatOptions {
  destination: string;
  /** The trip's diets; no check without one. */
  dietary: string[];
  budgetTier: "budget" | "balanced" | "premium";
  travelStyle?: "classic" | "backpacker";
  language?: SupportedLanguage;
  userId?: string;
}

/** What the check found and did, for the generation's log. */
export interface PlacesToEatResult {
  /** Places to eat looked up. */
  checked: number;
  /** Closed on Maps. */
  closed: number;
  /** Not on Maps. */
  missing: number;
  /** Written again as an open place. */
  replaced: number;
  /** Left out: no try found an open place. */
  dropped: number;
  /** Searches Google didn't answer, or past the plan's share: those places stay as written. */
  unanswered: number;
  /** What the model's tries cost. */
  costUsd: number;
}

type DayInPlan = { city?: unknown; activities?: unknown };

export interface PlacesToEatCheck {
  /** Starts looking up a day's places to eat while the rest of the plan is written. */
  look(day: DayInPlan): void;
  /**
   * Every place to eat in `days` looked up, and those closed or missing replaced
   * by open ones or left out, in place. A new place repeats none in `others`, the rest
   * of the trip.
   */
  finish(days: ItineraryDay[], others?: ItineraryDay[]): Promise<PlacesToEatResult>;
}

/**
 * The check for one plan, or null when there is nothing to check: no diet, no
 * Google key, or PLACES_TO_EAT_CHECK set to "false".
 */
export function placesToEatCheck(opts: PlacesToEatOptions): PlacesToEatCheck | null {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  if (!key || process.env.PLACES_TO_EAT_CHECK === "false" || opts.dietary.length === 0) return null;

  const searches = new Map<string, Promise<FoundPlace[] | null>>();
  const areaOf = (day: DayInPlan) => (typeof day.city === "string" && day.city ? day.city : opts.destination);
  // Every place in the trip so far, so a new one repeats none, and two get different ones.
  const names: string[] = [];
  const inTrip = (name: string) => names.some((n) => samePlace(n, name));
  // The model's calls, those made while the plan is written included.
  const meter = new GeminiCostMeter();
  // Open places sought while the rest of the plan is written, by the name of the one they replace.
  const early = new Map<string, Promise<Activity | null>>();

  /** What a search for the activity found, once per name and area; null when there is no answer. */
  const found = (activity: Named, area: string): Promise<FoundPlace[] | null> => {
    const query = `${searchName(activity.name)}, ${area}`;
    let search = searches.get(query);
    if (!search) {
      if (searches.size >= MAX_SEARCHES) return Promise.resolve(null);
      search = searchPlaces(key, query, pointOf(activity));
      searches.set(query, search);
    }
    return search;
  };

  /** An open place in place of the activity, the first of the model's options that is; null when none is. */
  const openInstead = (activity: Activity, day: ItineraryDay, area: string): Promise<Activity | null> =>
    meter.run(async () => {
      const tried = [activity.name];
      for (let round = 0; round < ROUNDS; round++) {
        const options = await replacementOptions(
          {
            destination: area,
            activityToReplace: activity,
            dayContext: day,
            budgetTier: opts.budgetTier,
            existingActivityNames: [...names, ...tried],
            preferences: { similarTo: true },
            travelStyle: opts.travelStyle,
            dietary: opts.dietary,
            language: opts.language,
            userId: opts.userId,
          },
          OPTIONS,
        ).catch(() => []);
        for (const fresh of options) {
          // One the trip has already needs no lookup.
          if (!inTrip(fresh.name)) {
            const places = await found(fresh, area);
            // Unanswered, a new place is no worse a bet than one Maps has as closed.
            if ((!places || placeStatus(fresh, places) === "open") && !inTrip(fresh.name)) {
              names.push(fresh.name);
              withActivityDefaults({ activities: [fresh] });
              return fresh;
            }
          }
          tried.push(fresh.name);
        }
      }
      return null;
    });

  return {
    look(day) {
      if (!Array.isArray(day.activities)) return;
      const activities = (day.activities as Activity[]).filter((a) => typeof a?.name === "string");
      names.push(...activities.map((a) => a.name));
      for (const activity of activities) {
        if (!isPlaceToEat(activity)) continue;
        const area = areaOf(day);
        void found(activity, area).then((places) => {
          if (places && placeStatus(activity, places) !== "open" && !early.has(activity.name)) {
            early.set(activity.name, openInstead(activity, day as unknown as ItineraryDay, area));
          }
        });
      }
    },

    async finish(days, others = []) {
      const result: PlacesToEatResult = { checked: 0, closed: 0, missing: 0, replaced: 0, dropped: 0, unanswered: 0, costUsd: 0 };
      // The trip as written in full, in place of the days as they came.
      names.splice(0, names.length, ...[...days, ...others].flatMap((d) => (d.activities ?? []).map((a) => a.name)));

      const bad: { day: ItineraryDay; activity: Activity; area: string }[] = [];
      await Promise.all(
        days.flatMap((day) =>
          day.activities.filter(isPlaceToEat).map(async (activity) => {
            const area = areaOf(day);
            const places = await found(activity, area);
            result.checked++;
            if (!places) {
              result.unanswered++;
              return;
            }
            const status = placeStatus(activity, places);
            if (status === "open") return;
            result[status]++;
            bad.push({ day, activity, area });
          }),
        ),
      );

      // What was sought early stands, unless a later day has that place; the rest is sought now.
      const instead = new Map<Activity, Activity | null>();
      for (const { activity } of bad) {
        const sought = early.get(activity.name);
        if (!sought) continue;
        const fresh = await sought;
        if (fresh && inTrip(fresh.name)) continue;
        if (fresh) names.push(fresh.name);
        instead.set(activity, fresh);
      }
      await Promise.all(
        bad
          .filter(({ activity }) => !instead.has(activity))
          .map(async ({ day, activity, area }) => instead.set(activity, await openInstead(activity, day, area))),
      );

      for (const { day, activity } of bad) {
        const fresh = instead.get(activity);
        const at = day.activities.indexOf(activity);
        if (fresh) {
          day.activities[at] = fresh;
          result.replaced++;
        } else {
          day.activities.splice(at, 1);
          result.dropped++;
        }
      }
      result.costUsd = meter.usd;
      return result;
    },
  };
}
