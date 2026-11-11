/**
 * A trip typed into the destination box as a request ("18 days in Vietnam in
 * August, family of four") rather than a place: one short question reads it
 * into the wizard's fields. The answer is checked by readingOf before
 * anything is filled in, and the words themselves go to the planner as notes.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";
import { TRIP_VIBES } from "@/types";
import type { ReadingAnswer } from "@/lib/wizard/request-reading";

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    places: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          days: { type: SchemaType.INTEGER },
        },
        required: ["name", "days"],
      },
    },
    days: { type: SchemaType.INTEGER },
    start_date: { type: SchemaType.STRING },
    end_date: { type: SchemaType.STRING },
    month: { type: SchemaType.INTEGER },
    who: { type: SchemaType.STRING },
    vibes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING, enum: [...TRIP_VIBES] } },
    budget: { type: SchemaType.STRING },
  },
  required: ["places", "days", "start_date", "end_date", "month", "who", "vibes", "budget"],
};

const TIMEOUT_MS = 8000;

/** The question, with the day of the week so "next Friday" can be counted. */
export function readingQuestion(text: string, today: string, language: SupportedLanguage): string {
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return [
    "Someone typed this into a trip planner's destination box, where a place's name goes:",
    '"""',
    text,
    '"""',
    `Today is ${today}, a ${weekday}.`,
    "",
    "Read the trip it asks for, and take nothing that isn't in it:",
    `- places: the places they want to stay in or visit, in the order of the trip, each as Google Maps names it in ${LANGUAGE_NAMES[language]}. A country or region they name is one place, unless they also name the places to visit in it. Leave out where they set off from or fly home from, unless they stay there. With each place, the days they give it, else 0. No places when they name none.`,
    "- days: how many days the whole trip lasts, when they say or their dates show it, else 0.",
    '- start_date and end_date: YYYY-MM-DD, only when they give dates: the next such dates from today. Else "".',
    "- month: the month they travel in, 1 to 12, when they name one but no dates, else 0.",
    '- who: "solo", "couple", "family" or "friends", when they say who is going, else "".',
    "- vibes: only those their words ask for, else none.",
    '- budget: "budget" or "luxury", when they say, else "".',
  ].join("\n");
}

/**
 * The request as the model reads it. No answer when there is no key, or the
 * question fails or takes too long: the words then go to the notes as they are.
 */
export async function askForReading(
  text: string,
  today: string,
  language: SupportedLanguage,
  timeoutMs = TIMEOUT_MS
): Promise<{ answer: ReadingAnswer | null; costUsd: number }> {
  if (!process.env.GOOGLE_AI_API_KEY) return { answer: null, costUsd: 0 };
  const modelName = getModelForPurpose("request-reading");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 1024,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  try {
    const result = await withTimeout(model.generateContent(readingQuestion(text, today, language)), timeoutMs, "Reading");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as ReadingAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[read-request] not read:", err instanceof Error ? err.message : String(err));
    return { answer: null, costUsd: 0 };
  }
}
