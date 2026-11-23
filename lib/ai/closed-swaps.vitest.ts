import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/types";
import type { StuckStop } from "./closing-days";

/**
 * Over New Year in Tokyo a plan kept the Tokyo National Museum and Shinjuku
 * Gyoen on days they are shut, because they were shut on every date the
 * closing-day check could move them to. A sight with nowhere to go gets one
 * short question for up to three places, best first; the first one that is a
 * real place the plan doesn't have, and open that date, goes in its time.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
let modelConfig: { model?: string; generationConfig?: { responseSchema?: unknown } } | undefined;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: (config: typeof modelConfig) => {
      modelConfig = config;
      return { generateContent };
    },
  },
}));

import { askForSwaps, offersOf, swapClosedStops, withSwaps, type SwapAnswer } from "./closed-swaps";

const at = (start_time: string, name: string, extra: Partial<Activity> = {}) =>
  ({ start_time, duration_minutes: 150, name, type: "museum", description: "", location: "Ueno", coordinates: { lat: 35.7188, lng: 139.7765 }, tips: [], booking_required: false, time_slot: "morning", ...extra }) as Activity;
const tokyo = () => [
  { day_number: 1, date: "2027-12-29", activities: [at("09:30", "Tokyo National Museum"), at("12:30", "Ueno Seiyoken", { type: "restaurant", duration_minutes: 90, time_slot: "afternoon" })] },
  { day_number: 2, date: "2027-12-30", activities: [at("10:00", "teamLab Planets TOKYO DMM", { type: "attraction" })] },
];
const museum: StuckStop = { day: 1, date: "2027-12-29", name: "Tokyo National Museum", start_time: "09:30", duration_minutes: 150 };
const place = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "museum",
  description: "Art high above Roppongi.",
  location: "Roppongi",
  coordinates: { lat: 35.6605, lng: 139.7292 },
  ...extra,
});
const mori = place("Mori Art Museum");
const answerOf = (...places: unknown[]): SwapAnswer => ({ swaps: [{ n: 1, places }] });
const names = (days: Array<{ day_number: number; activities: Activity[] }>) =>
  days.map((d) => `${d.day_number}: ${d.activities.map((a) => `${a.start_time} ${a.duration_minutes} ${a.name}`).join(" | ")}`);
const swapIn = (days: ReturnType<typeof tokyo>, a: SwapAnswer) => withSwaps(days, offersOf(a, [museum]));

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockClear();
});

describe("offersOf", () => {
  it("reads each offer as a stop in the closed place's time, at most three per closed place, best first", () => {
    const offers = offersOf(answerOf(mori, place("National Art Center Tokyo"), place("Suntory Museum of Art"), place("21_21 Design Sight")), [museum]);
    expect(offers.map((o) => o.activity.name)).toEqual(["Mori Art Museum", "National Art Center Tokyo", "Suntory Museum of Art"]);
    expect(offers[0].activity).toMatchObject({ start_time: "09:30", duration_minutes: 150, type: "museum", location: "Roppongi", tips: [] });
    expect(offers[0].closed).toBe(museum);
  });

  it("drops an offer that isn't a real place, and every offer for a number not on the list", () => {
    expect(offersOf(answerOf(place("Mori", { coordinates: { lat: 0, lng: 0 } }), place("  "), "Mori Art Museum", null), [museum])).toEqual([]);
    expect(offersOf({ swaps: [{ n: 2, places: [mori] }, { n: "1", places: [mori] }, { n: 1, places: "Mori" }] }, [museum])).toEqual([]);
    expect(offersOf({}, [museum])).toEqual([]);
  });
});

describe("withSwaps", () => {
  it("puts an open place where the closed one was, in its time and length, the rest of the plan untouched", () => {
    const days = tokyo();
    const { days: out, swapped } = swapIn(days, answerOf(mori));
    expect(swapped).toBe(1);
    expect(names(out)).toEqual(["1: 09:30 150 Mori Art Museum | 12:30 90 Ueno Seiyoken", "2: 10:00 150 teamLab Planets TOKYO DMM"]);
    expect(out[0].activities[0]).toMatchObject({ type: "museum", location: "Roppongi", coordinates: { lat: 35.6605, lng: 139.7292 }, time_slot: "morning" });
    expect(out[1]).toBe(days[1]);
  });

  it("takes the first offer that can go in, and only one", () => {
    const out = swapIn(tokyo(), answerOf(place("teamLab Planets"), mori, place("National Art Center Tokyo")));
    expect(out.swapped).toBe(1);
    expect(names(out.days)[0]).toBe("1: 09:30 150 Mori Art Museum | 12:30 90 Ueno Seiyoken");
  });

  it("names the open place in the day's title and theme where they named the closed one", () => {
    const days = tokyo();
    const named = [{ ...days[0], title: "Ueno: Tokyo National Museum and lunch", theme: "Tokyo National Museum" }, { ...days[1], theme: "Digital art" }];
    const out = withSwaps(named, offersOf(answerOf(mori), [museum])).days;
    expect(out[0]).toMatchObject({ title: "Ueno: Mori Art Museum and lunch", theme: "Mori Art Museum" });
    expect(out[1].theme).toBe("Digital art");
    const plain = withSwaps([{ ...days[0], theme: "Art in Ueno" }], offersOf(answerOf(mori), [museum])).days[0];
    expect(plain.theme).toBe("Art in Ueno");
    expect("title" in plain).toBe(false);
  });

  it("never swaps in a place the plan already has, or the closed place under another name", () => {
    expect(swapIn(tokyo(), answerOf(place("teamLab Planets"))).swapped).toBe(0);
    expect(swapIn(tokyo(), answerOf(place("Tokyo National Museum Heiseikan"))).swapped).toBe(0);
  });

  it("does nothing when the closed place is no longer on its day", () => {
    expect(withSwaps(tokyo(), offersOf(answerOf(mori), [{ ...museum, day: 2 }])).swapped).toBe(0);
    expect(withSwaps(tokyo(), offersOf(answerOf(mori), [{ ...museum, day: 9 }])).swapped).toBe(0);
    expect(withSwaps(tokyo(), []).swapped).toBe(0);
  });
});

describe("swapClosedStops", () => {
  const allOpen = vi.fn(async () => ({ closings: new Map(), shutDates: new Map(), costUsd: 0.0002 }));

  it("asks nothing when no place is stuck", async () => {
    const ask = vi.fn();
    const check = vi.fn();
    const days = tokyo();
    expect(await swapClosedStops("Tokyo", days, [], "en", ask, check)).toEqual({ days, swapped: 0, costUsd: 0 });
    expect(ask).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it("asks once, in the plan's language, checks every offer on the closed place's date, and puts the first open one in", async () => {
    const ask = vi.fn(async () => ({ answer: answerOf(place("Nezu Museum"), mori, mori), costUsd: 0.0004 }));
    const nezuShut = vi.fn(async () => ({ closings: new Map(), shutDates: new Map([["nezu museum", ["2027-12-29"]]]), costUsd: 0.0002 }));
    const out = await swapClosedStops("Tokyo", tokyo(), [museum], "ja" as never, ask, nezuShut);
    expect(ask).toHaveBeenCalledWith("Tokyo", expect.any(Array), [museum], "ja");
    expect(nezuShut).toHaveBeenCalledWith("Tokyo", ["Nezu Museum", "Mori Art Museum"], ["2027-12-29"]);
    expect(out.swapped).toBe(1);
    expect(names(out.days)[0]).toContain("Mori Art Museum");
    expect(out.costUsd).toBeCloseTo(0.0006, 10);
  });

  it("keeps the closed place when every offer is shut on that date or that weekday", async () => {
    const ask = async () => ({ answer: answerOf(mori), costUsd: 0.0004 });
    const shutThatDay = async () => ({ closings: new Map(), shutDates: new Map([["mori art museum", ["2027-12-29"]]]), costUsd: 0.0002 });
    const shutWednesdays = async () => ({ closings: new Map([["mori art museum", ["Wednesday" as const]]]), shutDates: new Map(), costUsd: 0 });
    const shutAnotherDay = async () => ({ closings: new Map(), shutDates: new Map([["mori art museum", ["2027-12-31"]]]), costUsd: 0 });
    const thatDay = await swapClosedStops("Tokyo", tokyo(), [museum], "en", ask, shutThatDay);
    expect(thatDay.swapped).toBe(0);
    expect(thatDay.costUsd).toBeCloseTo(0.0006, 10);
    expect((await swapClosedStops("Tokyo", tokyo(), [museum], "en", ask, shutWednesdays)).swapped).toBe(0);
    expect((await swapClosedStops("Tokyo", tokyo(), [museum], "en", ask, shutAnotherDay)).swapped).toBe(1);
  });

  it("asks no check when the answer offers nothing that could go in", async () => {
    const check = vi.fn();
    const ask = async () => ({ answer: { swaps: [{ n: 1, places: [place("x", { coordinates: { lat: 0, lng: 0 } })] }, { n: 7, places: [mori] }] }, costUsd: 0.0004 });
    expect(await swapClosedStops("Tokyo", tokyo(), [museum], "en", ask, check)).toMatchObject({ swapped: 0, costUsd: 0.0004 });
    expect(check).not.toHaveBeenCalled();
  });

  it("goes ahead as answered when the check can't be asked", async () => {
    const ask = async () => ({ answer: answerOf(mori), costUsd: 0.0004 });
    expect((await swapClosedStops("Tokyo", tokyo(), [museum], "en", ask, allOpen)).swapped).toBe(1);
  });

  // London on Saturday 26 December 2026: the Tate is shut. The checked list holds Borough Market, shut from the
  // 25th to the 27th by its own page.
  const tate: StuckStop = { day: 1, date: "2026-12-26", name: "Tate Modern", start_time: "15:30", duration_minutes: 150 };
  const london = (date = "2026-12-26") => [{ day_number: 1, date, activities: [at("15:30", "Tate Modern")] }];
  const market = place("Borough Market", { type: "market", location: "Southwark", coordinates: { lat: 51.5055, lng: -0.091 } });
  const garden = place("Sky Garden", { type: "attraction", location: "City of London", coordinates: { lat: 51.5113, lng: -0.0836 } });

  it("passes over an offer the checked list says is shut that day, whatever the model says", async () => {
    const ask = async () => ({ answer: answerOf(market, garden), costUsd: 0.0004 });
    const out = await swapClosedStops("London, United Kingdom", london(), [tate], "en", ask, allOpen);
    expect(out.swapped).toBe(1);
    expect(names(out.days)[0]).toBe("1: 15:30 150 Sky Garden");
  });

  it("takes an offer the checked list says is open, where the model wrongly said shut", async () => {
    // Saturday 12 December: the market's page has it open; the model's answer shuts it.
    const shutByTheModel = async () => ({ closings: new Map(), shutDates: new Map([["borough market", ["2026-12-12"]]]), costUsd: 0.0002 });
    const ask = async () => ({ answer: answerOf(market), costUsd: 0.0004 });
    const saturday = { ...tate, date: "2026-12-12" };
    const out = await swapClosedStops("London, United Kingdom", london("2026-12-12"), [saturday], "en", ask, shutByTheModel);
    expect(out.swapped).toBe(1);
    expect(names(out.days)[0]).toBe("1: 15:30 150 Borough Market");
    expect(out.costUsd).toBeCloseTo(0.0006, 10);
  });
});

describe("askForSwaps", () => {
  it("names each closed place with its day, date and time, shows the plan, and asks for up to three places in the plan's language", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify(answerOf(mori)) } });
    const out = await askForSwaps("Tokyo", tokyo(), [museum], "it");
    expect(out.answer.swaps).toHaveLength(1);
    const question = generateContent.mock.calls[0][0];
    expect(question).toContain("1. Day 1 (Wednesday 2027-12-29), 09:30-12:00: Tokyo National Museum");
    expect(question).toContain("Day 1 (2027-12-29): 09:30 Tokyo National Museum; 12:30 Ueno Seiyoken");
    expect(question).toContain("up to three places to go instead, best first");
    expect(question).toContain("open to visitors on that date");
    expect(question).toContain("otherwise anything worth that time nearby");
    expect(question).toContain("in Italian.");
    expect(modelConfig?.model).toBe("gemini-3.6-flash");
    expect(JSON.stringify(modelConfig?.generationConfig?.responseSchema)).not.toContain("start_time");
  });

  it("gives a time without a length as the start alone, and no time at all when there is none", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify({ swaps: [] }) } });
    await askForSwaps("Tokyo", tokyo(), [{ ...museum, start_time: "9:30", duration_minutes: undefined }, { ...museum, start_time: undefined }], "en");
    const question = generateContent.mock.calls[0][0];
    expect(question).toContain("1. Day 1 (Wednesday 2027-12-29), 09:30: Tokyo National Museum");
    expect(question).toContain("2. Day 1 (Wednesday 2027-12-29): Tokyo National Museum");
  });

  it("answers nothing when the question fails, there is no key, or nothing is stuck", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => {
      throw new Error("overloaded");
    };
    expect(await askForSwaps("Tokyo", tokyo(), [museum], "en")).toEqual({ answer: {}, costUsd: 0 });
    expect(await askForSwaps("Tokyo", tokyo(), [], "en")).toEqual({ answer: {}, costUsd: 0 });
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    expect(await askForSwaps("Tokyo", tokyo(), [museum], "en")).toEqual({ answer: {}, costUsd: 0 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
