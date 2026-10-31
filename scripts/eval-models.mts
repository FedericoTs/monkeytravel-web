/**
 * The same trips written by different Gemini models, side by side, the way
 * production writes them: a short trip in one stream, a long one in parts
 * after an outline, a multi-city trip one city at a time, each from the places
 * travellers kept there. Prints validity, time to day 1, total time, cost and
 * a few quality signals. Calls Gemini for real; reads the database, writes
 * nothing. Run it with a testing key, not production's.
 *
 * Spend is capped at BUDGET_USD (default $1): a run starts only while a
 * worst-case run still fits, and a run that throws is counted as billed.
 *
 * MODELS=gemini-2.5-flash,gemini-2.5-flash-lite npx tsx --env-file=.env.local scripts/eval-models.mts "Lisbon, Portugal:3" "Rome, Italy:8"
 * CASES=cases.json OUT=plans.json MODELS=… npx tsx --env-file=.env.local scripts/eval-models.mts
 *
 * A case: {"destination": "Barcelona", "days": 3, "language": "es", "vibes": ["foodie"],
 * "budgetTier": "budget", "pace": "active", "mustDos": ["Sagrada Família"],
 * "travelStyle": "backpacker", "legs": [{"city": "Tokyo", "nights": 4}, {"city": "Kyoto", "nights": 3}]}
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { generateItineraryStream, parseStreamedItinerary } from "../lib/gemini";
import { generateTripOutline } from "../lib/ai/trip-outline";
import { writeInParts, writesInParts } from "../lib/ai/plan-in-parts";
import { generateMultiCityItinerary, type CityLeg } from "../lib/ai/multi-city";
import { knownPlacesFor, knownPlacesUsed, type KnownPlace } from "../lib/ai/known-places";
import { createDayParser, feedChunk } from "../lib/streaming/day-parser";
import { getModelForPurpose } from "../lib/ai/model-router";
import { ACTIVITY_TYPES } from "../lib/trip/activity-type";
import { isPlaceholderPoint } from "../lib/trip/placeholder-point";
import type { SupportedLanguage } from "../lib/ai/language";
import type { Activity, GeneratedItinerary, ItineraryDay, TripCreationParams } from "../types";

type Case = Pick<TripCreationParams, "destination"> &
  Partial<Pick<TripCreationParams, "budgetTier" | "pace" | "vibes" | "mustDos" | "travelStyle">> & {
    days: number;
    language?: SupportedLanguage;
    legs?: CityLeg[];
  };

// lib/ runs as CommonJS under tsx, and an import from this ES module would get
// a second copy of gemini-cost that lib/gemini's calls never reach.
const { GeminiCostMeter } = createRequire(import.meta.url)("../lib/ai/gemini-cost.ts") as typeof import("../lib/ai/gemini-cost");

const models = (process.env.MODELS ?? "gemini-2.5-flash").split(",").map((m) => m.trim());
const budget = Number(process.env.BUDGET_USD ?? 1);
// The most one run can cost: a long multi-city trip with every city written twice.
const MAX_RUN_USD = 0.25;
// Added for a run that throws: the responses it lost were billed all the same.
const FAILED_RUN_USD = 0.05;
const onList = new Set<string>(ACTIVITY_TYPES);

const cases: Case[] = process.env.CASES
  ? JSON.parse(readFileSync(process.env.CASES, "utf8"))
  : process.argv.slice(2).map((arg) => {
      const [destination, n] = arg.split(/:(?=\d+$)/);
      return { destination, days: Number(n) };
    });

function paramsFor(c: Case): TripCreationParams {
  const start = new Date(Date.now() + 30 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    destination: c.destination,
    startDate: iso(start),
    endDate: iso(new Date(start.getTime() + (c.days - 1) * 86400000)),
    budgetTier: c.budgetTier ?? "balanced",
    pace: c.pace ?? "moderate",
    vibes: c.vibes ?? ["cultural", "foodie"],
    interests: [],
    ...(c.mustDos ? { mustDos: c.mustDos } : {}),
    ...(c.travelStyle ? { travelStyle: c.travelStyle } : {}),
  };
}

const label = (c: Case) => `${c.destination}:${c.days}${c.language && c.language !== "en" ? ` ${c.language}` : ""}`;

type Written = { itinerary: GeneratedItinerary | null; firstDayMs: number | null; outlineUsd: number; note?: string };

async function oneStream(params: TripCreationParams, language: SupportedLanguage, known: KnownPlace[], t0: number): Promise<Written> {
  const parser = createDayParser();
  let firstDayMs: number | null = null;
  let fullText = "";
  for await (const chunk of generateItineraryStream(params, { language, knownPlaces: known })) {
    if (chunk.done) {
      fullText = chunk.fullText;
      break;
    }
    if (feedChunk(parser, chunk.text).length > 0) firstDayMs ??= Date.now() - t0;
  }
  return { itinerary: parseStreamedItinerary(fullText, params), firstDayMs, outlineUsd: 0 };
}

async function inParts(params: TripCreationParams, total: number, language: SupportedLanguage, known: KnownPlace[], t0: number): Promise<Written> {
  const outline = await generateTripOutline(params, total, language, known);
  if (!outline) return { ...(await oneStream(params, language, known, t0)), note: "no outline, one piece" };
  let firstDayMs: number | null = null;
  let itinerary: GeneratedItinerary | null = null;
  for await (const out of writeInParts(params, total, outline.days, { language })) {
    if (out.type === "day") firstDayMs ??= Date.now() - t0;
    else itinerary = out.itinerary;
  }
  return { itinerary, firstDayMs, outlineUsd: outline.costUsd };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const minutes = (t?: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const hasPoint = (a: Activity) =>
  typeof a.coordinates?.lat === "number" && typeof a.coordinates?.lng === "number" && (a.coordinates.lat !== 0 || a.coordinates.lng !== 0);

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Stops more than 50 km from the middle of their own day.
function farStops(day: ItineraryDay) {
  const points = (day.activities ?? []).filter(hasPoint).map((a) => a.coordinates!);
  if (points.length < 3) return 0;
  const mid = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const centre = { lat: mid(points.map((p) => p.lat)), lng: mid(points.map((p) => p.lng)) };
  return points.filter((p) => km(p, centre) > 50).length;
}

// A stop that starts before the one before it has ended, or has no time.
function timeClashes(day: ItineraryDay) {
  let clashes = 0;
  let end = -1;
  for (const a of day.activities ?? []) {
    const start = minutes(a.start_time);
    if (start === null || start < end) clashes++;
    if (start !== null) end = start + (Number(a.duration_minutes) || 0);
  }
  return clashes;
}

function mustDosKept(acts: Activity[], mustDos: string[]) {
  const texts = acts.map((a) => norm(`${a.name ?? ""} ${a.description ?? ""}`));
  return mustDos.filter((m) => {
    const words = norm(m).split(" ").filter((w) => w.length >= 4);
    return words.length > 0 && texts.some((t) => words.filter((w) => t.includes(w)).length >= Math.ceil(words.length * 0.6));
  }).length;
}

function signals(days: ItineraryDay[], want: number, known: KnownPlace[], mustDos: string[]) {
  const acts = days.flatMap((d) => d.activities ?? []);
  const seen = new Map<string, number>();
  for (const a of acts) seen.set(norm(a.name ?? ""), (seen.get(norm(a.name ?? "")) ?? 0) + 1);
  const located = acts.filter(hasPoint);
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(acts.length, 1))}%`;
  return {
    days: days.length === want ? "ok" : `${days.length}/${want}`,
    perDay: (acts.length / Math.max(days.length, 1)).toFixed(1),
    repeats: [...seen.values()].filter((n) => n > 1).length,
    located: pct(located.length),
    placeholder: located.filter((a) => isPlaceholderPoint(a.coordinates!.lat, a.coordinates!.lng)).length,
    far: days.reduce((s, d) => s + farStops(d), 0),
    clashes: days.reduce((s, d) => s + timeClashes(d), 0),
    typesOnList: pct(acts.filter((a) => onList.has(String(a.type))).length),
    descWords: Math.round(acts.reduce((s, a) => s + String(a.description ?? "").split(/\s+/).length, 0) / Math.max(acts.length, 1)),
    known: known.length ? `${knownPlacesUsed(days, known)}/${known.length}` : "-",
    mustDos: mustDos.length ? `${mustDosKept(acts, mustDos)}/${mustDos.length}` : "-",
  };
}

const runs: Record<string, unknown>[] = [];
let spent = 0;
let stopped = false;
for (const model of models) {
  process.env.GEMINI_MODEL_OVERRIDE = model;
  if (getModelForPurpose("trip-generation") !== model) {
    console.log(`${model}: not a known model, skipped`);
    continue;
  }
  for (const c of cases) {
    if (spent + MAX_RUN_USD > budget) {
      stopped = true;
      break;
    }
    const params = paramsFor(c);
    const language = c.language ?? "en";
    const legs = c.legs && c.legs.length > 1 ? c.legs : null;
    const total = legs ? legs.reduce((s, l) => s + l.nights, 0) : c.days;
    const known = legs
      ? (await Promise.all(legs.map((l) => knownPlacesFor({ ...params, destination: l.city }, l.nights, language)))).flat()
      : await knownPlacesFor(params, total, language);
    const meter = new GeminiCostMeter();
    const t0 = Date.now();
    let written: Written = { itinerary: null, firstDayMs: null, outlineUsd: 0 };
    let error: string | undefined;
    try {
      written = await meter.run<Written>(() =>
        legs
          ? generateMultiCityItinerary(params, legs, params.startDate, { language }).then((itinerary) => ({ itinerary, firstDayMs: null, outlineUsd: 0 }))
          : writesInParts(total)
            ? inParts(params, total, language, known, t0)
            : oneStream(params, language, known, t0)
      );
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 120) : String(err);
    }
    const measured = meter.usd + written.outlineUsd;
    // A plan that cost nothing means the meter missed it: count the worst case.
    const cost = error ? measured + FAILED_RUN_USD : written.itinerary && measured === 0 ? MAX_RUN_USD : measured;
    spent += cost;
    const doneMs = Date.now() - t0;
    const s = written.itinerary ? signals(written.itinerary.days, total, known, c.mustDos ?? []) : null;
    console.log(
      [
        model.padEnd(22),
        label(c).padEnd(26),
        written.itinerary ? "valid" : "FAILED",
        `day1 ${written.firstDayMs === null ? "-" : (written.firstDayMs / 1000).toFixed(1) + "s"}`,
        `done ${(doneMs / 1000).toFixed(1)}s`,
        `$${cost.toFixed(4)}`,
        s
          ? `days ${s.days} acts/day ${s.perDay} repeats ${s.repeats} located ${s.located} placeholder ${s.placeholder} far ${s.far} clashes ${s.clashes} types ${s.typesOnList} words ${s.descWords} known ${s.known} must-dos ${s.mustDos}`
          : error ?? "",
        written.note ?? "",
      ].join("  ")
    );
    runs.push({ model, case: label(c), params, language, legs, known: known.map((k) => k.name), firstDayMs: written.firstDayMs, doneMs, cost, error, signals: s, itinerary: written.itinerary });
  }
  if (stopped) break;
}
if (stopped) console.log(`\nStopped: another run could take the spend past the $${budget.toFixed(2)} budget.`);
console.log(`\nTotal spent: $${spent.toFixed(3)} of $${budget.toFixed(2)}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ budget, spent, runs }, null, 2));
