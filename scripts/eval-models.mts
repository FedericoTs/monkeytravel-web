/**
 * The same trips written by different Gemini models, side by side: a short
 * trip in one stream, a long one in parts after an outline (the production
 * paths). Prints validity, time to day 1, total time, cost, thinking tokens
 * and a few quality signals. Calls Gemini for real; nothing is written to the
 * database. Run it with a testing key, not production's.
 *
 * MODELS=gemini-2.5-flash,gemini-3.5-flash-lite npx tsx --env-file=.env.local scripts/eval-models.mts "Lisbon, Portugal:3" "Rome, Italy:8"
 */
import { writeFileSync } from "node:fs";
import { generateItineraryStream, parseStreamedItinerary } from "../lib/gemini";
import { generateTripOutline } from "../lib/ai/trip-outline";
import { writeInParts, writesInParts } from "../lib/ai/plan-in-parts";
import { createDayParser, feedChunk } from "../lib/streaming/day-parser";
import { geminiCostUsd } from "../lib/ai/gemini-cost";
import { getModelForPurpose } from "../lib/ai/model-router";
import { ACTIVITY_TYPES } from "../lib/trip/activity-type";
import type { GeneratedItinerary, ItineraryDay, TripCreationParams } from "../types";

const models = (process.env.MODELS ?? "gemini-2.5-flash").split(",").map((m) => m.trim());
const onList = new Set<string>(ACTIVITY_TYPES);

function paramsFor(destination: string, days: number): TripCreationParams {
  const start = new Date(Date.now() + 30 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    destination,
    startDate: iso(start),
    endDate: iso(new Date(start.getTime() + (days - 1) * 86400000)),
    budgetTier: "balanced",
    pace: "moderate",
    vibes: ["cultural", "foodie"],
    interests: [],
  } as TripCreationParams;
}

type Run = { itinerary: GeneratedItinerary | null; firstDayMs: number | null; doneMs: number; cost: number; thoughts: number; error?: string };

async function oneStream(params: TripCreationParams, t0: number): Promise<Run> {
  const model = getModelForPurpose("trip-generation");
  const parser = createDayParser();
  let firstDayMs: number | null = null;
  let fullText = "";
  let cost = 0;
  let thoughts = 0;
  for await (const chunk of generateItineraryStream(params, { language: "en" })) {
    if (chunk.done) {
      fullText = chunk.fullText;
      cost = geminiCostUsd(model, chunk.usageMetadata);
      thoughts = chunk.usageMetadata?.thoughtsTokenCount ?? 0;
      break;
    }
    if (feedChunk(parser, chunk.text).length > 0) firstDayMs ??= Date.now() - t0;
  }
  return { itinerary: parseStreamedItinerary(fullText, params), firstDayMs, doneMs: Date.now() - t0, cost, thoughts };
}

async function inParts(params: TripCreationParams, total: number, t0: number): Promise<Run> {
  const outline = await generateTripOutline(params, total, "en");
  if (!outline) return { ...(await oneStream(params, t0)), error: "no outline, one piece" };
  let firstDayMs: number | null = null;
  let itinerary: GeneratedItinerary | null = null;
  let cost = outline.costUsd;
  for await (const out of writeInParts(params, total, outline.days, { language: "en" })) {
    if (out.type === "day") firstDayMs ??= Date.now() - t0;
    else {
      itinerary = out.itinerary;
      cost += out.costUsd;
    }
  }
  return { itinerary, firstDayMs, doneMs: Date.now() - t0, cost, thoughts: -1 };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function signals(days: ItineraryDay[], want: number) {
  const acts = days.flatMap((d) => d.activities ?? []);
  const seen = new Map<string, number>();
  for (const a of acts) seen.set(norm(a.name ?? ""), (seen.get(norm(a.name ?? "")) ?? 0) + 1);
  const located = acts.filter((a) => typeof a.coordinates?.lat === "number" && typeof a.coordinates?.lng === "number" && (a.coordinates.lat !== 0 || a.coordinates.lng !== 0));
  return {
    days: days.length === want ? "ok" : `${days.length}/${want}`,
    perDay: (acts.length / Math.max(days.length, 1)).toFixed(1),
    repeats: [...seen.values()].filter((n) => n > 1).length,
    located: `${Math.round((100 * located.length) / Math.max(acts.length, 1))}%`,
    typesOnList: `${Math.round((100 * acts.filter((a) => onList.has(String(a.type))).length) / Math.max(acts.length, 1))}%`,
    descWords: Math.round(acts.reduce((s, a) => s + String(a.description ?? "").split(/\s+/).length, 0) / Math.max(acts.length, 1)),
  };
}

const rows: string[] = [];
const samples: Record<string, unknown> = {};
let spent = 0;
for (const model of models) {
  process.env.GEMINI_MODEL_OVERRIDE = model;
  if (getModelForPurpose("trip-generation") !== model) {
    rows.push(`${model}: not a known model, skipped`);
    continue;
  }
  for (const arg of process.argv.slice(2)) {
    const [destination, n] = arg.split(/:(?=\d+$)/);
    const total = Number(n);
    const params = paramsFor(destination, total);
    const t0 = Date.now();
    let run: Run;
    try {
      run = writesInParts(total) ? await inParts(params, total, t0) : await oneStream(params, t0);
    } catch (err) {
      run = { itinerary: null, firstDayMs: null, doneMs: Date.now() - t0, cost: 0, thoughts: 0, error: err instanceof Error ? err.message.slice(0, 80) : String(err) };
    }
    spent += run.cost;
    const s = run.itinerary ? signals(run.itinerary.days, total) : null;
    rows.push(
      [
        model.padEnd(22),
        arg.padEnd(20),
        run.itinerary ? "valid" : "FAILED",
        `day1 ${run.firstDayMs === null ? "-" : (run.firstDayMs / 1000).toFixed(1) + "s"}`,
        `done ${(run.doneMs / 1000).toFixed(1)}s`,
        `$${run.cost.toFixed(4)}`,
        run.thoughts >= 0 ? `think ${run.thoughts}` : "",
        s ? `days ${s.days} acts/day ${s.perDay} repeats ${s.repeats} located ${s.located} types ${s.typesOnList} words ${s.descWords}` : run.error ?? "",
      ].join("  ")
    );
    if (run.itinerary) {
      samples[`${model} | ${arg}`] = run.itinerary.days.slice(0, 2).map((d) => ({
        day: d.day_number,
        theme: d.theme,
        stops: d.activities.map((a) => `${a.start_time ?? ""} ${a.name} [${a.type}]`),
      }));
    }
    console.log(rows[rows.length - 1]);
  }
}
console.log(`\nTotal spent: $${spent.toFixed(3)}`);
if (process.env.SAMPLES_OUT) writeFileSync(process.env.SAMPLES_OUT, JSON.stringify(samples, null, 2));
