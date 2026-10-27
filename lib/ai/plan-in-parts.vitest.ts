import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";
import type { PartsYield } from "./plan-in-parts";

/**
 * A long trip written in parts at the same time: the days reach the planner
 * in trip order whichever part finishes first, each numbered and dated by its
 * place in the trip, and a part that fails stops the plan.
 */

type Part = { from: number; to: number };
type Behaviour = { delayMs: number; numberFromOne?: boolean; days?: number; fail?: boolean };
let behaviour: Record<number, Behaviour> = {};

const itineraryFor = (part: Part, b: Behaviour) => ({
  destination: { name: "Rome", country: "Italy" },
  days: Array.from({ length: b.days ?? part.to - part.from + 1 }, (_, i) => ({
    day_number: b.numberFromOne ? i + 1 : part.from + i,
    date: "1999-01-01",
    theme: `Theme ${part.from + i}`,
    activities: [{ name: `Place ${part.from + i}` }],
  })),
  trip_summary: { highlights: [`summary from part ${part.from}`] },
});

vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* (_params: unknown, opts: { part: Part }) {
    const b = behaviour[opts.part.from] ?? { delayMs: 0 };
    const text = JSON.stringify(itineraryFor(opts.part, b));
    await new Promise((resolve) => setTimeout(resolve, b.delayMs));
    if (b.fail) throw new Error("model said no");
    for (let i = 0; i < text.length; i += 50) yield { text: text.slice(i, i + 50), done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
  parseStreamedItinerary: (text: string) => JSON.parse(text),
}));

const { writeInParts, PartsError } = await import("./plan-in-parts");

const params = { destination: "Rome, Italy", startDate: "2027-05-01", endDate: "2027-05-10" } as TripCreationParams;
const outline = Array.from({ length: 10 }, (_, i) => ({ day_number: i + 1, theme: "t", area: "a", places: [`p${i}`] }));

async function collect(totalDays = 10) {
  const days: Array<{ day_number: number; date: string }> = [];
  let done: Extract<PartsYield, { type: "done" }> | null = null;
  for await (const out of writeInParts(params, totalDays, outline, {})) {
    if (out.type === "day") days.push(out.day as { day_number: number; date: string });
    else done = out;
  }
  return { days, done: done! };
}

beforeEach(() => {
  behaviour = {};
});

describe("writeInParts", () => {
  it("hands the days on in trip order when a later part finishes first", async () => {
    behaviour = { 1: { delayMs: 30 }, 5: { delayMs: 0 }, 8: { delayMs: 10 } };
    const { days, done } = await collect();
    expect(days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(done.parts).toBe(3);
    expect(done.itinerary.days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(done.itinerary.trip_summary).toEqual({ highlights: ["summary from part 1"] });
  });

  it("numbers and dates each day by its place in the trip, whatever the model wrote", async () => {
    behaviour = { 5: { delayMs: 0, numberFromOne: true } };
    const { days, done } = await collect();
    expect(days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(done.itinerary.days[4]).toMatchObject({ day_number: 5, date: "2027-05-05" });
    expect(done.itinerary.days[9]).toMatchObject({ day_number: 10, date: "2027-05-10" });
  });

  it("drops days a part writes beyond its own", async () => {
    behaviour = { 1: { delayMs: 0, days: 6 } };
    const { done } = await collect();
    expect(done.itinerary.days).toHaveLength(10);
    expect(done.itinerary.days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("stops with a PartsError when a part fails, after the days before it", async () => {
    behaviour = { 5: { delayMs: 0, fail: true } };
    const days: number[] = [];
    await expect(async () => {
      for await (const out of writeInParts(params, 10, outline, {})) {
        if (out.type === "day") days.push((out.day as { day_number: number }).day_number);
      }
    }).rejects.toBeInstanceOf(PartsError);
    expect(days).toEqual([1, 2, 3, 4]);
  });

  it("stops when a part comes back short", async () => {
    behaviour = { 8: { delayMs: 0, days: 1 } };
    await expect(collect()).rejects.toThrow(/days 8-10 came back with 1 days/);
  });
});
