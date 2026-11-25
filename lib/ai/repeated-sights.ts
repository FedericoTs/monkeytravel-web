/**
 * A long plan can visit the same sight on two days: a museum on the second day
 * and again on the eighth, the Peak Tram on the third and the last. Each later
 * visit gets another real place of its kind near the stop before it, at the
 * same time, from one short question for all of them, asked beside the dinner
 * question so the plan isn't slower. An answer that isn't a real place near
 * that stop, or one the plan already holds, is left out, and the repeat stays.
 * A sight they asked for by name is the visit kept. Meals, drinks, rides and
 * stays are left alone (lib/ai/repeated-meals.ts has the restaurants).
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { activityOf, held } from "@/lib/ai/must-dos";
import { nameTokens } from "@/lib/ai/assistant/saved-activities";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import { haversineKm } from "@/lib/map/geo";
import type { Activity } from "@/types";

type Stop = Partial<Activity> & { name?: string; type?: string; start_time?: string; duration_minutes?: number };
type Day = { day_number?: number; date?: string; city?: string; activities?: Stop[] };

/** How far from the place it was chosen near a replacement may be. */
const NEAR_KM = 5;
/** At most this many repeats in one question. */
const MAX_REPEATS = 10;
const TIMEOUT_MS = 8000;

/** What isn't a sight: going back to a meal, a drink, a ride or a stay is natural, or no visit. */
const NOT_A_SIGHT = new Set(["restaurant", "food", "foodie", "food_experience", "cafe", "bar", "nightlife", "transport", "accommodation", "hotel", "lodging"]);

const minutesOf = (time?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The same place, written as it was or a little differently: the shorter name's words all in the longer one when it
 * has two or more ("Peak Tram", "Victoria Peak Tram & Peak Tower"). One word has to be the whole of the other name:
 * "Beach" is not "Bondi Beach". A name with no word to tell it by is no place.
 */
export function samePlace(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 0) return false;
  return held(short, [long]) && (short.length > 1 || held(long, [short]));
}

/** A sight the plan visits again on another day, and where another is looked for. */
export interface SightRepeat {
  /** The repeated sight, as named on the visit to replace. */
  name: string;
  date: string;
  /** Its time, kept by the place that replaces it. */
  start_time: string;
  /** Its kind, kept by the place that replaces it. */
  type: string;
  /** The stop before it with a pin, or the repeat itself when none comes before. */
  near: string;
  at: { lat: number; lng: number };
  city: string;
}

type Visit = { day: Day; d: number; stops: Stop[]; i: number; words: string[] };

/** Where another place is looked for: near the stop before the visit, or the visit itself. */
function wantedFor({ day, stops, i }: Visit, destination: string): SightRepeat[] {
  const stop = stops[i];
  if (!day.date || !stop.start_time || !stop.name) return [];
  const before = stops
    .slice(0, i)
    .reverse()
    .find((s) => s.name && s.type !== "transport" && isRealPoint(s.coordinates));
  const anchor = before ?? (isRealPoint(stop.coordinates) ? stop : undefined);
  if (!anchor?.name || !anchor.coordinates) return [];
  return [
    {
      name: stop.name,
      date: day.date,
      start_time: stop.start_time,
      type: stop.type ?? "attraction",
      near: anchor.name,
      at: { lat: anchor.coordinates.lat, lng: anchor.coordinates.lng },
      city: day.city || destination,
    },
  ];
}

/**
 * Each visit to a sight the plan already visits on another day. Of one place's visits, the first they asked for by
 * name is kept, else the first; the others, on other days, are the repeats. The same day twice is that day's own
 * matter and left as it is.
 */
export function repeatedSights(days: Day[], destination: string, named: (stop: { name?: string }) => boolean = () => false): SightRepeat[] {
  const visits: Visit[] = days.flatMap((day, d) => {
    const stops = [...(day.activities ?? [])].sort((a, b) => (minutesOf(a.start_time) ?? 24 * 60) - (minutesOf(b.start_time) ?? 24 * 60));
    return stops.flatMap((stop, i) =>
      stop.name && !NOT_A_SIGHT.has(stop.type ?? "") ? [{ day, d, stops, i, words: nameTokens(stop.name) }] : []
    );
  });
  const kept: Visit[] = [];
  const repeats: Visit[] = [];
  for (const visit of visits) {
    const k = kept.findIndex((other) => samePlace(other.words, visit.words));
    if (k < 0) {
      kept.push(visit);
    } else if (kept[k].d !== visit.d) {
      if (named(visit.stops[visit.i]) && !named(kept[k].stops[kept[k].i])) {
        repeats.push(kept[k]);
        kept[k] = visit;
      } else {
        repeats.push(visit);
      }
    }
  }
  return repeats.flatMap((visit) => wantedFor(visit, destination)).slice(0, MAX_REPEATS);
}

const PLACE: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING, description: "The neighbourhood" },
    coordinates: {
      type: SchemaType.OBJECT,
      properties: { lat: { type: SchemaType.NUMBER }, lng: { type: SchemaType.NUMBER } },
      required: ["lat", "lng"],
    },
  },
  required: ["name", "description", "location", "coordinates"],
};
/** Places offered for one visit, best first: the first that can go in replaces it. */
const MAX_OFFERS = 3;
const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    replacements: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          n: { type: SchemaType.INTEGER, description: "The visit's number in the list" },
          places: { type: SchemaType.ARRAY, items: PLACE, description: "Three places, best first" },
        },
        required: ["n", "places"],
      },
    },
  },
  required: ["replacements"],
};

/** What the model answers: each visit's offers are checked, best first, before one goes in (withSightReplacements). */
export interface SightAnswer {
  replacements?: Array<{ n?: unknown; places?: unknown }>;
}

type SightOptions = { language: SupportedLanguage; taken?: string[] };

/**
 * The question: the places the plan already has first, then each repeat's place, date, time and kind. Asked for one
 * place, the model named places the plan already had; three, best first, leave room for one that can go in.
 */
export function sightQuestion(wanted: SightRepeat[], opts: SightOptions): string {
  return [
    "This trip visits some places twice.",
    ...(opts.taken?.length ? [`It already has these places: ${opts.taken.join("; ")}.`] : []),
    "For each later visit below, name three other real places to visit instead, best first: none of the places it already has, of the same kind if you can, within a short walk or ride of the place named, open at that time on that date.",
    ...wanted.map(
      (w, i) => `${i + 1}. ${w.city}, ${w.date} at ${w.start_time}, near ${w.near} (${w.at.lat.toFixed(5)}, ${w.at.lng.toFixed(5)}), instead of ${w.name} (${w.type})`
    ),
    "",
    "Different places for each visit, ones a visitor would be glad to see.",
    `Write each name as Google Maps shows it, its exact coordinates, and the description (about 20 words: what to see or do there and why) in ${LANGUAGE_NAMES[opts.language]}.`,
  ].join("\n");
}

/**
 * Another place for each repeat, as the model sees them. No answer when there is nothing to ask, no key, or the
 * question fails or takes too long: the repeats then stay.
 */
export async function askForSights(wanted: SightRepeat[], opts: SightOptions): Promise<{ answer: SightAnswer; costUsd: number }> {
  if (wanted.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { answer: {}, costUsd: 0 };
  const modelName = getModelForPurpose("dinners");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 2048,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  try {
    const result = await withTimeout(model.generateContent(sightQuestion(wanted, opts)), TIMEOUT_MS, "Repeated sights");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as SightAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[repeated-sights] not asked:", err instanceof Error ? err.message : String(err));
    return { answer: {}, costUsd: 0 };
  }
}

/** The names of the plan's sights, for the question's "none the plan already has". */
export function sightNames(days: Day[]): string[] {
  return [...new Set(days.flatMap((d) => d.activities ?? []).filter((s) => s.name && !NOT_A_SIGHT.has(s.type ?? "")).map((s) => s.name!))];
}

/**
 * The days with each visit's first offered place that can go in, in the repeat's place, at its time, length and
 * kind. An offer can't go in when it isn't a real place within 5 km of the place it was chosen near or the plan
 * already holds it; a visit keeps its repeat when none can, or when the repeat is gone from its day by now. Pure.
 */
export function withSightReplacements<D extends Day>(days: D[], wanted: SightRepeat[], answer: SightAnswer): { days: D[]; replaced: number } {
  let out = days;
  let replaced = 0;
  for (const entry of answer.replacements ?? []) {
    const want = typeof entry.n === "number" ? wanted[entry.n - 1] : undefined;
    if (!want || !Array.isArray(entry.places)) continue;
    const at = out.findIndex((d) => d.date === want.date);
    const index = at < 0 ? -1 : (out[at].activities ?? []).findIndex((s) => s.name === want.name && s.start_time === want.start_time);
    if (index < 0) continue;
    const repeat = out[at].activities![index];
    const planned = out.flatMap((d) => d.activities ?? []).map((s) => nameTokens(s.name ?? ""));
    const sight = (entry.places as unknown[])
      .slice(0, MAX_OFFERS)
      .map((place) =>
        place && typeof place === "object"
          ? activityOf({ ...(place as Record<string, unknown>), type: want.type, start_time: want.start_time, duration_minutes: repeat.duration_minutes || 90 })
          : null
      )
      .find((activity) => {
        if (!activity?.coordinates || haversineKm(activity.coordinates, want.at) > NEAR_KM) return false;
        const words = nameTokens(activity.name);
        return words.length > 0 && !planned.some((name) => samePlace(words, name));
      });
    if (!sight) continue;
    const placed = { ...sight, type: want.type } as Activity;
    out = out.map((d, i) => (i === at ? { ...d, activities: (d.activities ?? []).map((s, j) => (j === index ? placed : s)) } : d));
    replaced++;
  }
  return { days: out, replaced };
}
