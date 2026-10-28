/**
 * A long trip written in parts at the same time. One stream writes a whole
 * trip at ~3.5 s a day, so 14 days took a minute. Here an outline
 * (lib/ai/trip-outline.ts) fixes every day's places first, then each part of
 * up to four days streams on its own, and the days are handed on in order:
 * the first part's days as they arrive, each later part's once the parts
 * before it are done. Total time is the outline plus the slowest part.
 */

import { generateItineraryStream, parseStreamedItinerary } from "@/lib/gemini";
import { createDayParser, feedChunk } from "@/lib/streaming/day-parser";
import { geminiCostUsd } from "@/lib/ai/gemini-cost";
import { getModelForPurpose } from "@/lib/ai/model-router";
import { addIsoDays } from "@/lib/dates/iso-date";
import { splitIntoParts, type OutlineDay } from "@/lib/ai/trip-outline";
import type { SupportedLanguage } from "@/lib/ai/language";
import type { GeneratedItinerary, ItineraryDay, TripCreationParams } from "@/types";

/** Trips this long or longer are written in parts. */
export const PARTS_FROM_DAYS = 6;

export function writesInParts(totalDays: number): boolean {
  return totalDays >= PARTS_FROM_DAYS && process.env.PLAN_IN_PARTS !== "off";
}

/** A part that fails or comes back short is written again, once. */
const PART_ATTEMPTS = 2;

type Range = { from: number; to: number };

interface PartRun {
  range: Range;
  days: Record<string, unknown>[];
  done: boolean;
  itinerary?: GeneratedItinerary;
  costUsd: number;
  retried: boolean;
  error?: Error;
  waiters: Array<() => void>;
}

export type PartsYield =
  | { type: "day"; day: Record<string, unknown> }
  | { type: "done"; itinerary: GeneratedItinerary; costUsd: number; parts: number; retries: number };

/** Thrown when a part fails; carries what the parts that answered cost. */
export class PartsError extends Error {
  constructor(
    message: string,
    readonly costUsd: number
  ) {
    super(message);
  }
}

/** A part's days, numbered and dated by their place in the trip, whatever the model wrote. */
function placeDays<T extends object>(days: T[], range: Range, startDate: string): T[] {
  return days.slice(0, range.to - range.from + 1).map(
    (day, i) =>
      ({
        ...day,
        day_number: range.from + i,
        date: addIsoDays(startDate, range.from - 1 + i) ?? (day as { date?: string }).date,
      }) as T
  );
}

function startPart(
  params: TripCreationParams,
  range: Range,
  outline: OutlineDay[],
  opts: { language?: SupportedLanguage; userId?: string }
): PartRun {
  const run: PartRun = { range, days: [], done: false, costUsd: 0, retried: false, waiters: [] };
  const wake = () => run.waiters.splice(0).forEach((w) => w());
  const want = range.to - range.from + 1;
  void (async () => {
    for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
      const parser = createDayParser();
      let fullText = "";
      try {
        for await (const chunk of generateItineraryStream(params, { ...opts, part: { ...range, outline } })) {
          if (chunk.done) {
            fullText = chunk.fullText;
            run.costUsd += geminiCostUsd(getModelForPurpose("trip-generation"), chunk.usageMetadata);
            break;
          }
          const newDays = feedChunk(parser, chunk.text);
          if (newDays.length > 0) {
            run.days.push(...newDays);
            wake();
          }
        }
        const itinerary = parseStreamedItinerary(fullText, params);
        if (itinerary.days.length < want) {
          throw new Error(`days ${range.from}-${range.to} came back with ${itinerary.days.length} days`);
        }
        run.itinerary = itinerary;
        run.error = undefined;
        break;
      } catch (err) {
        run.error = err instanceof Error ? err : new Error(String(err));
        if (attempt < PART_ATTEMPTS) {
          console.warn(`[plan-in-parts] days ${range.from}-${range.to} written again: ${run.error.message}`);
          run.retried = true;
          // Days already handed on stay; the next attempt's days follow on from them.
          run.days = [];
        }
      }
    }
    run.done = true;
    wake();
  })();
  return run;
}

const changed = (run: PartRun) => new Promise<void>((resolve) => run.waiters.push(resolve));

/** Write the trip in parts. Throws PartsError when a part fails or comes back short twice. */
export async function* writeInParts(
  params: TripCreationParams,
  totalDays: number,
  outline: OutlineDay[],
  opts: { language?: SupportedLanguage; userId?: string }
): AsyncGenerator<PartsYield, void, unknown> {
  const runs = splitIntoParts(totalDays).map((range) => startPart(params, range, outline, opts));
  const spent = () => runs.reduce((sum, run) => sum + run.costUsd, 0);

  for (const run of runs) {
    let handed = 0;
    for (;;) {
      const fresh = placeDays(run.days.slice(handed), { from: run.range.from + handed, to: run.range.to }, params.startDate);
      for (const day of fresh) yield { type: "day", day };
      handed += fresh.length;
      if (run.done) break;
      await changed(run);
    }
    if (run.error) throw new PartsError(run.error.message, spent());
    const days = run.itinerary!.days;
    // Days the progressive parser missed come from the full parse.
    for (const day of placeDays(days, run.range, params.startDate).slice(handed)) {
      yield { type: "day", day: { ...day } };
    }
  }

  const itinerary: GeneratedItinerary = {
    ...runs[0].itinerary!,
    days: runs.flatMap((run) => placeDays<ItineraryDay>(run.itinerary!.days, run.range, params.startDate)),
  };
  yield { type: "done", itinerary, costUsd: spent(), parts: runs.length, retries: runs.filter((run) => run.retried).length };
}
