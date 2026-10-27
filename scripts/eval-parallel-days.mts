/**
 * One trip written two ways, side by side: in one piece (today's stream) and
 * in parts at the same time after an outline. Prints time to day 1, total
 * time, cost, and places repeated across days. Calls Gemini for real, $0.05
 * to $0.10 per case; nothing is written to the database.
 *
 * npx tsx --env-file=.env.local scripts/eval-parallel-days.mts "Rome, Italy:10" "Tokyo, Japan:14"
 */
import { generateItineraryStream, parseStreamedItinerary } from "../lib/gemini";
import { generateTripOutline, splitIntoParts } from "../lib/ai/trip-outline";
import { createDayParser, feedChunk } from "../lib/streaming/day-parser";
import { geminiCostUsd } from "../lib/ai/gemini-cost";
import { getModelForPurpose } from "../lib/ai/model-router";
import type { ItineraryDay, TripCreationParams } from "../types";

const MODEL = getModelForPurpose("trip-generation");

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
    // MUST_DOS="Roscioli carbonara; Galleria Borghese" adds must-dos.
    ...(process.env.MUST_DOS ? { mustDos: process.env.MUST_DOS.split(";").map((m) => m.trim()) } : {}),
  } as TripCreationParams;
}

async function runStream(params: TripCreationParams, t0: number, part?: Parameters<typeof generateItineraryStream>[1]) {
  const parser = createDayParser();
  let firstDayMs: number | null = null;
  let fullText = "";
  let cost = 0;
  for await (const chunk of generateItineraryStream(params, { language: "en", ...part })) {
    if (chunk.done) {
      fullText = chunk.fullText;
      cost = geminiCostUsd(MODEL, chunk.usageMetadata);
      break;
    }
    if (feedChunk(parser, chunk.text).length > 0) firstDayMs ??= Date.now() - t0;
  }
  return { itinerary: parseStreamedItinerary(fullText, params), firstDayMs, doneMs: Date.now() - t0, cost };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function repeats(days: ItineraryDay[]) {
  const dayOf = new Map<string, Set<number>>();
  for (const day of days) {
    for (const a of day.activities) {
      const key = norm(a.name);
      if (!dayOf.has(key)) dayOf.set(key, new Set());
      dayOf.get(key)!.add(day.day_number);
    }
  }
  return [...dayOf.entries()].filter(([, d]) => d.size > 1).map(([name, d]) => `${name} (days ${[...d].join(",")})`);
}

function shape(days: ItineraryDay[], want: number) {
  const numbered = days.every((d, i) => d.day_number === i + 1);
  const perDay = days.map((d) => d.activities.length);
  return { days: days.length, ok: days.length === want && numbered, perDay: perDay.join("/") };
}

for (const arg of process.argv.slice(2)) {
  const [destination, n] = arg.split(/:(?=\d+$)/);
  const total = Number(n);
  const params = paramsFor(destination, total);

  const t0 = Date.now();
  const one = await runStream(params, t0);

  const t1 = Date.now();
  const outline = await generateTripOutline(params, total);
  const outlineMs = Date.now() - t1;
  if (!outline) {
    console.log(JSON.stringify({ destination, total, error: "no outline" }));
    continue;
  }
  const parts = await Promise.all(
    splitIntoParts(total).map((range) => runStream(params, t1, { part: { ...range, outline: outline.days } }))
  );
  const merged = parts.flatMap((p) => p.itinerary.days);

  console.log(
    JSON.stringify(
      {
        destination,
        total,
        onePiece: {
          firstDayS: (one.firstDayMs ?? 0) / 1000,
          totalS: one.doneMs / 1000,
          usd: +one.cost.toFixed(4),
          ...shape(one.itinerary.days, total),
          repeats: repeats(one.itinerary.days),
        },
        parts: {
          count: parts.length,
          outlineS: outlineMs / 1000,
          firstDayS: (parts[0].firstDayMs ?? 0) / 1000,
          totalS: Math.max(...parts.map((p) => p.doneMs)) / 1000,
          usd: +(outline.costUsd + parts.reduce((s, p) => s + p.cost, 0)).toFixed(4),
          ...shape(merged, total),
          repeats: repeats(merged),
          mustDos: params.mustDos?.map((m) => ({
            mustDo: m,
            days: merged.filter((d) => d.activities.some((a) => norm(a.name).includes(norm(m).split(" ")[0]))).map((d) => d.day_number),
          })),
          summary: parts[0].itinerary.trip_summary?.highlights?.slice(0, 3),
        },
      },
      null,
      2
    )
  );
}
