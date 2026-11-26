/**
 * A fast outline of a whole trip: for each day a theme, an area, the places it
 * is built around, and where it has lunch and dinner. A long trip is then
 * written in parts at the same time (app/api/ai/generate/stream), each part
 * told which places and restaurants belong to the other days, so the parts
 * never repeat one. The outline sees every day, the parts only their own:
 * without the meals here a part left days without dinner, and parts chose the
 * same restaurants.
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import type { TripCreationParams } from "@/types";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import type { KnownPlace } from "@/lib/ai/known-places";
import { occasionLine, stayLine, travelDaysLine, travellersLine } from "@/lib/ai/trip-prompt";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

export interface OutlineDay {
  day_number: number;
  theme: string;
  area: string;
  places: string[];
  /** The day's lunch and dinner restaurants; empty when the traveller isn't there then (arriving after, leaving before). */
  lunch?: string;
  dinner?: string;
}

export interface TripOutline {
  days: OutlineDay[];
  costUsd: number;
}

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    days: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          day_number: { type: SchemaType.INTEGER },
          theme: { type: SchemaType.STRING, description: "A few words, e.g. 'Old town and the river'." },
          area: { type: SchemaType.STRING, description: "The neighbourhood or nearby town the day happens in." },
          places: {
            type: SchemaType.ARRAY,
            description: "2 to 4 real, named places the day is built around: sights and experiences, and any must-do put on this day.",
            items: { type: SchemaType.STRING },
          },
          lunch: {
            type: SchemaType.STRING,
            description: "A real restaurant for lunch near the day's places, open at midday on this date. Empty only when the traveller isn't there at midday.",
          },
          dinner: {
            type: SchemaType.STRING,
            description: "A real restaurant for dinner near where the day ends, open at the local dinner hour. Empty only when the traveller isn't there in the evening.",
          },
        },
        required: ["day_number", "theme", "area", "places", "lunch", "dinner"],
      },
    },
  },
  required: ["days"],
};

const normalize = (place: string) =>
  place
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The outline, or null when it can't be had: the caller then writes the trip in one piece. */
export async function generateTripOutline(
  params: TripCreationParams,
  totalDays: number,
  language?: SupportedLanguage,
  knownPlaces: KnownPlace[] = []
): Promise<TripOutline | null> {
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      // Two restaurants a day on top of the places: a 14-day outline runs past 2,048 tokens.
      maxOutputTokens: 3072,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });

  const lines = [
    `Outline a ${totalDays}-day trip to ${params.destination}, ${params.startDate} to ${params.endDate}.`,
    `Budget: ${params.budgetTier}. Pace: ${params.pace}.`,
    params.vibes?.length ? `Vibes, most important first: ${params.vibes.join(", ")}.` : "",
    params.interests?.length ? `Interests: ${params.interests.join(", ")}.` : "",
    params.travelStyle === "backpacker" ? "Backpacker trip: free and cheap sights, walking tours, markets." : "",
    travellersLine(params),
    occasionLine(params),
    travelDaysLine(params),
    stayLine(params),
    params.mustDos?.length
      ? `Must-dos, each on exactly one sensible day as one of its places, meals included: ${params.mustDos.join("; ")}.`
      : "",
    knownPlaces.length
      ? `Places travellers kept here, to build the days from first where they suit this trip, each on one day at most and named exactly as listed: ${knownPlaces.map((p) => p.name).join("; ")}.`
      : "",
    params.requirements ? `Requirements: ${params.requirements}` : "",
    params.profilePreferences?.dietaryPreferences?.length
      ? `Diet: ${params.profilePreferences.dietaryPreferences.join(", ")}. Every place to eat must suit it.`
      : "",
    "",
    `Return exactly ${totalDays} days, numbered 1 to ${totalDays}. Give each day its own area, keep each day's places close together, and never use a place on two days. The best-known sights come early; later days can go further out or off the beaten path. Use real place names as Google Maps shows them.`,
    "Give each day its lunch, near its places at midday, and its dinner, near where it ends at the local dinner hour: real restaurants open then, suited to the budget, and never the same restaurant on two days.",
    // The outline is shown while the plan is written, so it speaks the page's language.
    language && language !== "en" ? `Write each theme and area in ${LANGUAGE_NAMES[language]}.` : "",
  ];

  try {
    const result = await model.generateContent(lines.filter((l) => l !== "").join("\n"));
    const usage = result.response.usageMetadata;
    const parsed = JSON.parse(result.response.text()) as { days?: OutlineDay[] };
    const days = (parsed.days ?? []).filter(
      (d) => Number.isInteger(d.day_number) && typeof d.theme === "string" && Array.isArray(d.places)
    );
    if (days.length !== totalDays) return null;
    days.sort((a, b) => a.day_number - b.day_number);
    if (days.some((d, i) => d.day_number !== i + 1)) return null;

    // A place the model put on two days stays on the first, and so does a restaurant: the later day's part then
    // chooses its own.
    const seen = new Set<string>();
    const eaten = new Set<string>();
    for (const day of days) {
      day.places = day.places.filter((p) => {
        const key = normalize(p);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      for (const meal of ["lunch", "dinner"] as const) {
        const raw = day[meal];
        const name = typeof raw === "string" ? raw.trim() : "";
        const key = normalize(name);
        day[meal] = key && !eaten.has(key) ? name : "";
        if (key) eaten.add(key);
      }
    }
    return { days, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.error("[trip-outline] failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Days 1..totalDays in consecutive parts of at most `maxDays`, as even as possible. */
export function splitIntoParts(totalDays: number, maxDays = 4): Array<{ from: number; to: number }> {
  const count = Math.ceil(totalDays / maxDays);
  const parts: Array<{ from: number; to: number }> = [];
  let from = 1;
  for (let i = 0; i < count; i++) {
    const size = Math.ceil((totalDays - from + 1) / (count - i));
    parts.push({ from, to: from + size - 1 });
    from += size;
  }
  return parts;
}
