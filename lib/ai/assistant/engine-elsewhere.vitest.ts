/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * Asked for another place for the whole trip ("give me Málaga"), the wizard's
 * assistant used to rewrite the days under the old place's name: a Málaga plan
 * titled "Moab, USA". It now offers the place (or 2-3, for "somewhere else"),
 * and the page plans the one picked anew; the days are left alone.
 */

const generateContent = vi.fn();
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent: (req: unknown) => generateContent(req) };
      }
    },
  };
});
vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));

import { assistTrip, buildPrompt, type AssistInput } from "./engine";

const sight = (name: string, start_time: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "nature",
  time_slot: "morning",
  start_time,
  duration_minutes: 90,
  description: "",
  location: "",
  estimated_cost: { amount: 20, currency: "USD", tier: "budget" },
  ...extra,
});
const day = (n: number, extra: Record<string, unknown> = {}) =>
  ({
    day_number: n,
    date: `2027-05-1${n}`,
    activities: [sight(`Trail ${n}`, "09:00", extra), sight(`Lunch ${n}`, "13:00", { type: "restaurant" }), sight(`View ${n}`, "17:00")],
  }) as unknown as ItineraryDay;
const input = (over: Partial<AssistInput> = {}): AssistInput => ({
  message: "Give me Málaga",
  destination: "Moab, USA",
  tripTitle: "Moab Trip",
  days: [day(1), day(2)],
  locale: "en",
  autoApply: true,
  canPlanElsewhere: true,
  ...over,
});
const answer = (obj: unknown) => ({ response: { text: () => JSON.stringify(obj), usageMetadata: {} } });
const MALAGA = { name: "Málaga", country: "Spain" };

describe("the prompt", () => {
  it("lets the wizard offer another place for a trip in one place", () => {
    const p = buildPrompt(input());
    expect(p).toContain("The WHOLE trip somewhere else");
    expect(p).toContain('"elsewhere": [] OR');
  });

  it("does not where the page can't plan it, on a multi-city trip, or with a fixed plan", () => {
    const multiCity = [{ ...day(1), city: "Moab" }, { ...day(2), city: "Bluff" }] as ItineraryDay[];
    for (const p of [
      buildPrompt(input({ canPlanElsewhere: undefined })),
      buildPrompt(input({ days: multiCity })),
      buildPrompt(input({ days: [day(1, { locked: true }), day(2)] })),
    ]) {
      expect(p).not.toContain("The WHOLE trip somewhere else");
      expect(p).not.toContain('"elsewhere"');
    }
  });
});

describe("assistTrip", () => {
  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = "test-key";
    generateContent.mockReset();
  });

  it("hands back the place offered and its reply, with the days left alone", async () => {
    generateContent.mockResolvedValue(
      answer({ reply: "Málaga suits a sunny stag-do: direct flights, beaches and nightlife.", edits: [], elsewhere: [MALAGA] })
    );
    const r = await assistTrip(input());
    expect(r.elsewhere).toEqual([MALAGA]);
    expect(r.edits).toEqual([]);
    expect(r.reply).toBe("Málaga suits a sunny stag-do: direct flights, beaches and nightlife.");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("keeps no claim that the trip already moved, and asks the model nothing more", async () => {
    generateContent.mockResolvedValue(answer({ reply: "I've updated your trip to Málaga!", edits: [], elsewhere: [MALAGA] }));
    const r = await assistTrip(input());
    expect(r.reply).toBe("Pick a place below and I'll plan it for the same dates.");
    expect(r.elsewhere).toEqual([MALAGA]);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("is not sent back for the days it leaves alone", async () => {
    // Without places, "I propose…" and no edits is a change handed over and missing: one more try.
    generateContent.mockResolvedValue(answer({ reply: "I propose Málaga: direct flights and beaches.", edits: [], elsewhere: [MALAGA] }));
    const r = await assistTrip(input());
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe("I propose Málaga: direct flights and beaches.");
  });

  it("offers nothing on a page that can't plan it", async () => {
    generateContent.mockResolvedValue(answer({ reply: "Málaga would be great.", edits: [], elsewhere: [MALAGA] }));
    expect((await assistTrip(input({ canPlanElsewhere: false }))).elsewhere).toBeUndefined();
  });

  it("lets a change to the days win over an offer in the same reply", async () => {
    const riverDay = { day_number: 2, summary: "A river day", activities: [sight("Colorado River float", "09:00"), sight("Lunch at the dock", "13:00", { type: "restaurant" }), sight("Fisher Towers", "17:00")] };
    generateContent.mockResolvedValue(answer({ reply: "Day 2 is now a river day.", edits: [riverDay], elsewhere: [MALAGA] }));
    const r = await assistTrip(input({ message: "make day 2 a river day" }));
    expect(r.elsewhere).toBeUndefined();
    expect(r.edits.map((e) => e.day_number)).toEqual([2]);
  });
});
