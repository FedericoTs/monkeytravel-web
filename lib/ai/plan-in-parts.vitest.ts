import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";
import type { PartsYield } from "./plan-in-parts";

/**
 * A long trip written in parts at the same time: the days reach the planner
 * in trip order whichever part finishes first, each numbered and dated by its
 * place in the trip. A part that fails is written again once; failing twice
 * stops the plan.
 */

type Part = { from: number; to: number };
type Behaviour = {
  delayMs: number;
  numberFromOne?: boolean;
  days?: number;
  fail?: boolean;
  firstAttempt?: "throws" | "breaks" | "short";
  refusal?: string;
  /** Where the part's stops are pinned. */
  pin?: { lat: number; lng: number };
};
let behaviour: Record<number, Behaviour> = {};
let attempts: Record<number, number> = {};

const itineraryFor = (part: Part, b: Behaviour, attempt: number, days = b.days ?? part.to - part.from + 1) => ({
  destination: { name: "Rome", country: "Italy" },
  days: Array.from({ length: days }, (_, i) => ({
    day_number: b.numberFromOne ? i + 1 : part.from + i,
    date: "1999-01-01",
    theme: `Theme ${part.from + i}, attempt ${attempt}`,
    activities: [{ name: `Place ${part.from + i}`, ...(b.pin ? { coordinates: b.pin } : {}) }],
  })),
  trip_summary: { highlights: [`summary from part ${part.from}`] },
});

vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* (_params: unknown, opts: { part: Part }) {
    const b = behaviour[opts.part.from] ?? { delayMs: 0 };
    const attempt = (attempts[opts.part.from] = (attempts[opts.part.from] ?? 0) + 1);
    const first = attempt === 1 ? b.firstAttempt : undefined;
    let text = JSON.stringify(itineraryFor(opts.part, b, attempt, first === "short" ? 1 : undefined));
    // Broken JSON inside the part's second day, as the model sometimes writes.
    if (first === "breaks") text = text.replace(`"Theme ${opts.part.from + 1}, attempt 1"`, `Theme ${opts.part.from + 1}`);
    await new Promise((resolve) => setTimeout(resolve, b.delayMs));
    if (b.refusal) throw new Error(b.refusal);
    if (b.fail || first === "throws") throw new Error("model said no");
    for (let i = 0; i < text.length; i += 50) yield { text: text.slice(i, i + 50), done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
// Where the cities table puts the destination, asked only when two parts can't tell which of them is turned.
let destinationPoint: { lat: number; lng: number } | null = null;
const cityPointsFor = vi.fn(async (cities: string[]) => cities.map(() => destinationPoint));
vi.mock("@/lib/ai/city-points", () => ({ cityPointsFor }));

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
  attempts = {};
  destinationPoint = null;
  cityPointsFor.mockClear();
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

  it("writes a part that fails again and finishes the plan", async () => {
    behaviour = { 5: { delayMs: 0, firstAttempt: "throws" } };
    const { days, done } = await collect();
    expect(days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(done.retries).toBe(1);
    expect(attempts[5]).toBe(2);
    expect(attempts[1]).toBe(1);
  });

  it("writes a part with broken JSON again, without handing a day on twice", async () => {
    behaviour = { 5: { delayMs: 0, firstAttempt: "breaks" } };
    const { days, done } = await collect();
    expect(days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(done.retries).toBe(1);
    // The finished plan holds the second attempt's days for that part.
    expect(done.itinerary.days.slice(4, 7).map((d) => d.theme)).toEqual([
      "Theme 5, attempt 2",
      "Theme 6, attempt 2",
      "Theme 7, attempt 2",
    ]);
  });

  it("writes a part that comes back short again", async () => {
    behaviour = { 8: { delayMs: 0, firstAttempt: "short" } };
    const { done } = await collect();
    expect(done.itinerary.days.map((d) => d.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(done.retries).toBe(1);
  });

  it("stops with a PartsError when a part fails twice, after the days before it", async () => {
    behaviour = { 5: { delayMs: 0, fail: true } };
    const days: number[] = [];
    await expect(async () => {
      for await (const out of writeInParts(params, 10, outline, {})) {
        if (out.type === "day") days.push((out.day as { day_number: number }).day_number);
      }
    }).rejects.toBeInstanceOf(PartsError);
    expect(days).toEqual([1, 2, 3, 4]);
    expect(attempts[5]).toBe(2);
  });

  it("doesn't write a part again when the model is out of credit", async () => {
    behaviour = { 5: { delayMs: 0, refusal: `{"error":{"code":402,"message":"Your prepayment credits are depleted."}}` } };
    await expect(collect()).rejects.toBeInstanceOf(PartsError);
    expect(attempts[5]).toBe(1);
  });

  it("stops when a part comes back short twice", async () => {
    behaviour = { 8: { delayMs: 0, days: 1 } };
    await expect(collect()).rejects.toThrow(/days 8-10 came back with 1 days/);
  });
});

// An 11-day trip to a village in Bahia came back with its last part's pins north of the equator and east of
// Greenwich: three days on the Gulf of Aden, each dinner thousands of kilometres from its day.
describe("a part written on the far side of the world", () => {
  const ROME = { lat: 41.9, lng: 12.5 };
  const MIRRORED = { lat: -41.9, lng: -12.5 };
  const pinsOf = (done: Extract<PartsYield, { type: "done" }>) =>
    done.itinerary.days.map((d) => (d.activities[0] as { coordinates?: { lat: number; lng: number } }).coordinates);

  it("is turned back beside the other parts", async () => {
    behaviour = { 1: { delayMs: 0, pin: ROME }, 5: { delayMs: 0, pin: ROME }, 8: { delayMs: 0, pin: MIRRORED } };
    const { done } = await collect();
    expect(pinsOf(done)).toEqual(Array.from({ length: 10 }, () => ROME));
    expect(cityPointsFor).not.toHaveBeenCalled();
  });

  it("of two, is the one the destination's place isn't beside", async () => {
    behaviour = { 1: { delayMs: 0, pin: ROME }, 4: { delayMs: 0, pin: MIRRORED } };
    destinationPoint = { lat: 41.89, lng: 12.49 };
    const { done } = await collect(6);
    expect(pinsOf(done)).toEqual(Array.from({ length: 6 }, () => ROME));
    expect(cityPointsFor).toHaveBeenCalledWith(["Rome"]);
  });

  it("of two, stays when the destination's place isn't known: either could be the turned one", async () => {
    behaviour = { 1: { delayMs: 0, pin: ROME }, 4: { delayMs: 0, pin: MIRRORED } };
    const { done } = await collect(6);
    expect(pinsOf(done)).toEqual([ROME, ROME, ROME, MIRRORED, MIRRORED, MIRRORED]);
  });

  it("of two, stays when the destination's place is a namesake beside neither", async () => {
    behaviour = { 1: { delayMs: 0, pin: ROME }, 4: { delayMs: 0, pin: MIRRORED } };
    // The biggest place of the name on another continent: Rome's mirror lands nearer it than Rome does.
    destinationPoint = { lat: -34.6, lng: -58.4 };
    const { done } = await collect(6);
    expect(pinsOf(done)).toEqual([ROME, ROME, ROME, MIRRORED, MIRRORED, MIRRORED]);
  });

  it("leaves parts that agree, and asks the cities table nothing", async () => {
    behaviour = { 1: { delayMs: 0, pin: ROME }, 4: { delayMs: 0, pin: { lat: 41.95, lng: 12.45 } } };
    const { done } = await collect(6);
    expect(pinsOf(done)).toEqual([ROME, ROME, ROME, { lat: 41.95, lng: 12.45 }, { lat: 41.95, lng: 12.45 }, { lat: 41.95, lng: 12.45 }]);
    expect(cityPointsFor).not.toHaveBeenCalled();
  });
});
