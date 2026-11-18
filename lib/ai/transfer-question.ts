/**
 * A trip through several cities gets a card for each hop between them (lib/ai/transfer-legs.ts). Estimated from
 * the straight line, its way and time were often wrong for well-known hops: three and a half hours by train from
 * Brussels to Paris (82 minutes), a train from Istanbul to Cappadocia (travellers fly), a flight from Jaipur to
 * Jaisalmer. The plans' own model knows them. So one short question asks, for the whole route, how most travellers
 * make each hop and how long the ride itself takes, beside the cities' own plans so the trip isn't slower. No key,
 * a failure or 8 s without an answer leave every card to the estimate.
 */
import { SchemaType, type ResponseSchema } from "@/lib/ai/genai-compat";
import { genAI, withTimeout } from "@/lib/ai/gemini-call";
import { getModelForPurpose, thinkingConfigFor } from "@/lib/ai/model-router";
import { geminiCostUsd, recordGeminiUsage } from "@/lib/ai/gemini-cost";
import type { KnownHop } from "@/lib/ai/transfer-legs";

const MODES: ReadonlyArray<KnownHop["mode"]> = ["train", "flight", "bus", "car", "ferry"];
const TIMEOUT_MS = 8000;

const HOP: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    n: { type: SchemaType.INTEGER, description: "The hop's number in the list" },
    mode: { type: SchemaType.STRING, enum: [...MODES] },
    minutes: { type: SchemaType.INTEGER, description: "How long the ride itself usually takes" },
  },
  required: ["n", "mode", "minutes"],
};
const SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: { hops: { type: SchemaType.ARRAY, items: HOP } },
  required: ["hops"],
};

/** Each hop's answer, by its number; anything that isn't one of the ways and a number of minutes is left out. */
function hopsOf(answer: { hops?: unknown }, count: number): Array<KnownHop | undefined> {
  const hops: Array<KnownHop | undefined> = Array.from({ length: count }, () => undefined);
  for (const entry of Array.isArray(answer.hops) ? answer.hops : []) {
    const { n, mode, minutes } = (entry ?? {}) as { n?: unknown; mode?: unknown; minutes?: unknown };
    if (typeof n !== "number" || n < 1 || n > count || hops[n - 1]) continue;
    if (!MODES.includes(mode as KnownHop["mode"]) || typeof minutes !== "number" || !Number.isFinite(minutes)) continue;
    hops[n - 1] = { mode: mode as KnownHop["mode"], minutes: Math.round(minutes) };
  }
  return hops;
}

/**
 * How most travellers make each hop of the route (cities in order): hops[i] is the one from cities[i] to
 * cities[i + 1]. Empty when there is no hop, no key, or the question fails or takes too long.
 */
export async function askForTransfers(cities: string[]): Promise<{ hops: Array<KnownHop | undefined>; costUsd: number }> {
  const count = cities.length - 1;
  if (count < 1 || !process.env.GOOGLE_AI_API_KEY) return { hops: [], costUsd: 0 };
  const modelName = getModelForPurpose("transfers");
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
    `A trip goes ${cities.join(" -> ")}. For each hop below, how do most travellers make it, and how long does the ride itself usually take, in minutes, on the usual direct or fastest service (not counting getting to the station, airport or port, or waiting there)?`,
    ...cities.slice(1).map((to, i) => `${i + 1}. ${cities[i]} to ${to}`),
    "Answer train, flight, bus, car or ferry for each. A train journey with a change counts as one train ride.",
    "Where the way over land takes more than about 6 hours and there is a direct flight, answer the flight.",
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(question), TIMEOUT_MS, "Transfers");
    const usage = result.response.usageMetadata;
    recordGeminiUsage(modelName, usage);
    return { hops: hopsOf(JSON.parse(result.response.text()) as { hops?: unknown }, count), costUsd: geminiCostUsd(modelName, usage) };
  } catch (err) {
    console.warn("[transfers] not asked:", err instanceof Error ? err.message : String(err));
    return { hops: [], costUsd: 0 };
  }
}
