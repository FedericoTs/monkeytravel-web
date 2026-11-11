/**
 * Plans are written in Latin letters, and now and then a name comes back with
 * characters of another writing system stuck inside a word: "Green波
 * Restaurant", "Niku no万世 Akihabara Honten", "Nam대mun". Such names get one
 * short question for each place's usual name. An answer goes in only when it
 * keeps every Latin part of the name and has no word like that itself;
 * otherwise the name stays as it was.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import { LANGUAGE_NAMES, type SupportedLanguage } from "@/lib/ai/language";

// Hangul, kana and CJK ideographs.
const OTHER = "\\u1100-\\u11ff\\u3040-\\u30ff\\u3130-\\u318f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff";
const GLUED = new RegExp(`\\p{Script=Latin}[${OTHER}]|[${OTHER}]\\p{Script=Latin}`, "u");
const LATIN_RUNS = /\p{Script=Latin}+/gu;

/** Whether a name has a word with letters of two writing systems in it. */
export function gluedName(name: string): boolean {
  return GLUED.test(name);
}

type Named = { name?: unknown } | null | undefined;

/** The names on these days with a word like that, each once. */
export function gluedNames(days: Array<{ activities?: Named[] }>): string[] {
  const names = days.flatMap((d) => (d.activities ?? []).map((a) => a?.name));
  return [...new Set(names.filter((n): n is string => typeof n === "string" && gluedName(n)))];
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether an answer may stand in for a glued name: every Latin part kept, no glued word left. */
export function fitsAsName(glued: string, usual: string): boolean {
  const name = usual.trim();
  if (name.length > 120 || gluedName(name)) return false;
  const folded = fold(name);
  return (glued.match(LATIN_RUNS) ?? []).every((run) => folded.includes(fold(run)));
}

const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    names: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          number: { type: SchemaType.INTEGER, description: "Its number in the list" },
          name: { type: SchemaType.STRING },
        },
        required: ["number", "name"],
      },
    },
  },
  required: ["names"],
};

/** What the model answers: each name is checked before it goes in (fitsAsName). */
export interface NamesAnswer {
  names?: Array<{ number?: unknown; name?: unknown }>;
}

const TIMEOUT_MS = 5000;

/**
 * The usual names, as the model gives them. No answer when there is no key, or
 * the question fails or takes too long: the names then stay as they were.
 */
export async function askForNames(
  destination: string,
  glued: string[],
  language: SupportedLanguage,
  timeoutMs = TIMEOUT_MS
): Promise<{ answer: NamesAnswer; costUsd: number }> {
  if (glued.length === 0 || !process.env.GOOGLE_AI_API_KEY) return { answer: {}, costUsd: 0 };
  const modelName = getModelForPurpose("trip-generation");
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 1024,
      thinkingConfig: thinkingConfigFor(modelName),
    },
  });
  const question = [
    `In a travel plan for ${destination}, these place names have characters of another writing system stuck inside a word by mistake:`,
    ...glued.map((name, i) => `${i + 1}. ${name}`),
    "",
    `For each one, give the place's usual name as Google Maps shows it in ${LANGUAGE_NAMES[language]}: Latin letters only, and the words already in Latin letters kept as they are, untranslated.`,
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(question), timeoutMs, "Names");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { answer: JSON.parse(result.response.text()) as NamesAnswer, costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[names] not asked:", err instanceof Error ? err.message : String(err));
    return { answer: {}, costUsd: 0 };
  }
}

/** Each glued name the answer gives a fitting usual name for, with that name. */
export function renamesOf(glued: string[], answer: NamesAnswer): Map<string, string> {
  const renames = new Map<string, string>();
  for (const entry of answer.names ?? []) {
    const from = glued[Number(entry.number) - 1];
    if (from && typeof entry.name === "string" && fitsAsName(from, entry.name)) renames.set(from, entry.name.trim());
  }
  return renames;
}

/** These days with every renamed activity under its usual name. */
export function withNames<D extends { activities: A[] }, A extends { name: string }>(days: D[], renames: Map<string, string>): D[] {
  if (renames.size === 0) return days;
  return days.map((day) =>
    day.activities.some((a) => renames.has(a.name))
      ? { ...day, activities: day.activities.map((a) => (renames.has(a.name) ? { ...a, name: renames.get(a.name) as string } : a)) }
      : day
  );
}

/** A plan with its glued names under their usual names, and how many were glued and renamed. */
export async function keepNamesInOneScript<T extends { days: D[] }, D extends { activities: A[] }, A extends { name: string }>(
  itinerary: T,
  destination: string,
  language: SupportedLanguage,
  ask: typeof askForNames = askForNames
): Promise<{ itinerary: T; costUsd: number; glued: number; renamed: number }> {
  const glued = gluedNames(itinerary.days);
  if (glued.length === 0) return { itinerary, costUsd: 0, glued: 0, renamed: 0 };
  const { answer, costUsd } = await ask(destination, glued, language);
  const renames = renamesOf(glued, answer);
  return {
    itinerary: renames.size > 0 ? { ...itinerary, days: withNames(itinerary.days, renames) } : itinerary,
    costUsd,
    glued: glued.length,
    renamed: renames.size,
  };
}
