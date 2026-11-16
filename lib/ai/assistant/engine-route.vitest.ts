/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A trip through several cities told a new route ("the last 3 days back in
 * Lisbon"). The engine's own prompt moved days between cities in place, and
 * the city guard then took the moved places off, while the reply said the days
 * had moved. A question of its own reads the route; a route it reads is offered
 * as a whole, and no day moves for it.
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

const { assistTrip } = await import("./engine");

const at = (name: string, start_time: string) => ({ name, start_time, time_slot: "morning", type: "attraction", duration_minutes: 90 });
// Lisbon days 1-7, Porto 8-14.
const twoCities = Array.from({ length: 14 }, (_, i) => ({
  day_number: i + 1,
  date: `2027-03-${String(10 + i).padStart(2, "0")}`,
  city: i < 7 ? "Lisboa" : "Porto",
  activities: [at(`${i < 7 ? "Lisboa" : "Porto"} sight ${i + 1}`, "10:00")],
})) as unknown as ItineraryDay[];
const each = (...runs: Array<[string, number]>) => runs.flatMap(([city, n]) => Array.from({ length: n }, () => city));

const isRouteQuestion = (req: unknown) => typeof req === "string" && req.includes("Does the message tell a different route");
/** The route question answers `days`; the edit call moves Days 12-14's places to Lisbon in place. */
const replies = (days: string[]) => async (req: unknown) =>
  isRouteQuestion(req)
    ? { response: { text: () => JSON.stringify({ days }), usageMetadata: {} } }
    : {
        response: {
          text: () =>
            JSON.stringify({
              reply: "I've moved the last 3 days back to Lisbon.",
              edits: [12, 13, 14].map((n) => ({ day_number: n, city: "Porto", activities: [at("Chiado walk", "10:00")] })),
            }),
          usageMetadata: {},
        },
      };
const input = { message: "the last 3 days back in Lisbon", destination: "Lisboa e Porto, Portugal", tripTitle: "Lisboa e Porto", days: twoCities, startDate: "2027-03-10", locale: "en" };

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
});

describe("assistTrip on a route told anew", () => {
  it("offers the route it reads as a whole, and moves no day for it", async () => {
    generateContent.mockImplementation(replies(each(["Lisboa, Portugal", 7], ["Porto, Portugal", 4], ["Lisboa, Portugal", 3])));
    const out = await assistTrip({ ...input, canPlanRoute: true });
    expect(out.route?.map((s) => [s.name, s.days])).toEqual([["Lisboa", 7], ["Porto", 4], ["Lisboa", 3]]);
    expect(out.edits).toEqual([]);
    expect(out.reply).toBe(
      "Your new route: Lisboa (7 days) → Porto (4 days) → Lisboa (3 days). Tap the button below and I'll plan the whole trip that way, for the same dates.",
    );
  });

  it("keeps the edit when the question reads no new route", async () => {
    generateContent.mockImplementation(replies([]));
    const out = await assistTrip({ ...input, message: "add Chiado to day 12", canPlanRoute: true });
    expect(out.route).toBeUndefined();
    expect(generateContent.mock.calls.some(([req]) => isRouteQuestion(req))).toBe(true);
  });

  it("asks no route question on a page that can't plan one, or on a trip in one place", async () => {
    generateContent.mockImplementation(replies(each(["Lisboa, Portugal", 7], ["Porto, Portugal", 4], ["Lisboa, Portugal", 3])));
    expect((await assistTrip({ ...input, canPlanRoute: false })).route).toBeUndefined();
    const oneCity = twoCities.map(({ city: _city, ...d }) => d) as unknown as ItineraryDay[];
    expect((await assistTrip({ ...input, days: oneCity, canPlanRoute: true })).route).toBeUndefined();
    expect(generateContent.mock.calls.some(([req]) => isRouteQuestion(req))).toBe(false);
  });

  it("asks no route question on a trip with a fixed plan, which a plan made anew couldn't keep", async () => {
    generateContent.mockImplementation(replies(each(["Lisboa, Portugal", 7], ["Porto, Portugal", 4], ["Lisboa, Portugal", 3])));
    const fixed = twoCities.map((d, i) =>
      i === 13 ? { ...d, activities: [{ ...at("Flight home", "18:00"), type: "transport", locked: true, anchor_id: "a1" }] } : d,
    ) as unknown as ItineraryDay[];
    expect((await assistTrip({ ...input, days: fixed, canPlanRoute: true })).route).toBeUndefined();
    expect(generateContent.mock.calls.some(([req]) => isRouteQuestion(req))).toBe(false);
  });
});
