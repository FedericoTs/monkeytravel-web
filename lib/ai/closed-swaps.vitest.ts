import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/types";
import type { StuckStop } from "./closing-days";

/**
 * Over New Year in Tokyo a plan kept the Tokyo National Museum and Shinjuku
 * Gyoen on days they are shut, because they were shut on every date the
 * closing-day check could move them to. A sight with nowhere to go gets one
 * short question, and the answer goes in, in its time, only when it is a real
 * place the plan doesn't already have.
 */

let answer: () => Promise<{ response: { text: () => string; usageMetadata?: object } }>;
const generateContent = vi.fn((_question: string) => answer());
let modelConfig: { model?: string } | undefined;
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: (config: typeof modelConfig) => {
      modelConfig = config;
      return { generateContent };
    },
  },
}));

import { askForSwaps, swapClosedStops, withSwaps, type SwapAnswer } from "./closed-swaps";

const at = (start_time: string, name: string, extra: Partial<Activity> = {}) =>
  ({ start_time, duration_minutes: 150, name, type: "museum", description: "", location: "Ueno", coordinates: { lat: 35.7188, lng: 139.7765 }, tips: [], booking_required: false, time_slot: "morning", ...extra }) as Activity;
const tokyo = () => [
  { day_number: 1, date: "2027-12-29", activities: [at("09:30", "Tokyo National Museum"), at("12:30", "Ueno Seiyoken", { type: "restaurant", duration_minutes: 90, time_slot: "afternoon" })] },
  { day_number: 2, date: "2027-12-30", activities: [at("10:00", "teamLab Planets TOKYO DMM", { type: "attraction" })] },
];
const museum: StuckStop = { day: 1, date: "2027-12-29", name: "Tokyo National Museum", start_time: "09:30", duration_minutes: 150 };
const mori = (extra: Record<string, unknown> = {}) => ({
  n: 1,
  activity: {
    start_time: "11:00",
    duration_minutes: 120,
    name: "Mori Art Museum",
    type: "museum",
    description: "Contemporary art high above Roppongi.",
    location: "Roppongi",
    coordinates: { lat: 35.6605, lng: 139.7292 },
    ...extra,
  },
});
const names = (days: Array<{ day_number: number; activities: Activity[] }>) =>
  days.map((d) => `${d.day_number}: ${d.activities.map((a) => `${a.start_time} ${a.duration_minutes} ${a.name}`).join(" | ")}`);

afterEach(() => {
  vi.unstubAllEnvs();
  generateContent.mockClear();
});

describe("withSwaps", () => {
  it("puts an open place where the closed one was, in its time and length, the rest of the plan untouched", () => {
    const days = tokyo();
    const { days: out, swapped } = withSwaps(days, [museum], { swaps: [mori()] });
    expect(swapped).toBe(1);
    expect(names(out)).toEqual(["1: 09:30 150 Mori Art Museum | 12:30 90 Ueno Seiyoken", "2: 10:00 150 teamLab Planets TOKYO DMM"]);
    expect(out[0].activities[0]).toMatchObject({ type: "museum", location: "Roppongi", coordinates: { lat: 35.6605, lng: 139.7292 }, time_slot: "morning" });
    expect(out[1]).toBe(days[1]);
  });

  it("names the open place in the day's title and theme where they named the closed one", () => {
    const days = tokyo();
    const named = [{ ...days[0], title: "Ueno: Tokyo National Museum and lunch", theme: "Tokyo National Museum" }, { ...days[1], theme: "Digital art" }];
    const out = withSwaps(named, [museum], { swaps: [mori()] }).days;
    expect(out[0]).toMatchObject({ title: "Ueno: Mori Art Museum and lunch", theme: "Mori Art Museum" });
    expect(out[1].theme).toBe("Digital art");
    const plain = withSwaps([{ ...days[0], theme: "Art in Ueno" }], [museum], { swaps: [mori()] }).days[0];
    expect(plain.theme).toBe("Art in Ueno");
    expect("title" in plain).toBe(false);
  });

  it("leaves the closed place when the answer isn't a real place", () => {
    for (const bad of [mori({ coordinates: { lat: 0, lng: 0 } }), mori({ name: "  " }), mori({ start_time: "soon" }), mori({ duration_minutes: 5 })]) {
      expect(withSwaps(tokyo(), [museum], { swaps: [bad] }).swapped).toBe(0);
    }
  });

  it("never swaps in a place the plan already has, or the closed place under another name", () => {
    expect(withSwaps(tokyo(), [museum], { swaps: [mori({ name: "teamLab Planets" })] }).swapped).toBe(0);
    expect(withSwaps(tokyo(), [museum], { swaps: [mori({ name: "Tokyo National Museum Heiseikan" })] }).swapped).toBe(0);
  });

  it("takes one swap per closed place, and none for a number that isn't on the list", () => {
    const out = withSwaps(tokyo(), [museum], { swaps: [mori(), mori({ name: "National Art Center Tokyo" }), { ...mori({ name: "Suntory Museum" }), n: 2 }] });
    expect(out.swapped).toBe(1);
    expect(names(out.days)[0]).toContain("Mori Art Museum");
  });

  it("does nothing when the closed place is no longer on its day", () => {
    expect(withSwaps(tokyo(), [{ ...museum, day: 2 }], { swaps: [mori()] }).swapped).toBe(0);
    expect(withSwaps(tokyo(), [{ ...museum, day: 9 }], { swaps: [mori()] }).swapped).toBe(0);
    expect(withSwaps(tokyo(), [museum], {} as SwapAnswer).swapped).toBe(0);
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

  it("asks once, in the plan's language, checks the swap on the closed place's date, and puts it in", async () => {
    const ask = vi.fn(async () => ({ answer: { swaps: [mori()] }, costUsd: 0.0004 }));
    allOpen.mockClear();
    const out = await swapClosedStops("Tokyo", tokyo(), [museum], "ja" as never, ask, allOpen);
    expect(ask).toHaveBeenCalledWith("Tokyo", expect.any(Array), [museum], "ja");
    expect(allOpen).toHaveBeenCalledWith("Tokyo", ["Mori Art Museum"], ["2027-12-29"]);
    expect(out.swapped).toBe(1);
    expect(out.costUsd).toBeCloseTo(0.0006, 10);
  });

  it("keeps out a swap the check finds shut on that date, or on that weekday", async () => {
    const ask = async () => ({ answer: { swaps: [mori()] }, costUsd: 0.0004 });
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
    const ask = async () => ({ answer: { swaps: [mori({ coordinates: { lat: 0, lng: 0 } }), { ...mori(), n: 7 }] }, costUsd: 0.0004 });
    expect(await swapClosedStops("Tokyo", tokyo(), [museum], "en", ask, check)).toMatchObject({ swapped: 0, costUsd: 0.0004 });
    expect(check).not.toHaveBeenCalled();
  });
});

describe("askForSwaps", () => {
  it("names each closed place with its day, date and time, shows the plan, and asks in the plan's language", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    answer = async () => ({ response: { text: () => JSON.stringify({ swaps: [mori()] }) } });
    const out = await askForSwaps("Tokyo", tokyo(), [museum], "it");
    expect(out.answer.swaps).toHaveLength(1);
    const question = generateContent.mock.calls[0][0];
    expect(question).toContain("1. Day 1 (Wednesday 2027-12-29), 09:30-12:00: Tokyo National Museum");
    expect(question).toContain("Day 1 (2027-12-29): 09:30 Tokyo National Museum; 12:30 Ueno Seiyoken");
    expect(question).toContain("open to visitors on that date");
    expect(question).toContain("in Italian.");
    expect(modelConfig?.model).toBe("gemini-3.6-flash");
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
