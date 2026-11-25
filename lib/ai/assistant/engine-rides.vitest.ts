/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A change to every day of a trip through two cities ("no restaurants") can come back with the day they reach the
 * second city rewritten without the train there, leaving them in Porto with no way of getting there. The engine
 * keeps the plan's ride unless the traveller talks about getting there.
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

const stop = (id: string, name: string, start_time: string, type = "attraction", duration_minutes = 90) => ({ id, name, start_time, time_slot: "morning", duration_minutes, type });
const days = [
  { day_number: 1, date: "2027-04-01", city: "Lisbon", activities: [stop("a1", "Belém Tower", "10:00"), stop("a2", "Time Out Market", "13:00", "restaurant")] },
  {
    day_number: 2,
    date: "2027-04-02",
    city: "Porto",
    activities: [
      { id: "r1", name: "Train to Porto", type: "transport", transport_mode: "train", start_time: "08:30", time_slot: "morning", duration_minutes: 180, location: "Lisbon" },
      stop("b1", "Livraria Lello", "12:30", "attraction", 60),
      stop("b2", "Café Santiago", "13:45", "restaurant"),
    ],
  },
] as unknown as ItineraryDay[];
const withoutMeals = {
  response: {
    text: () =>
      JSON.stringify({
        reply: "I've removed the restaurants from both days.",
        edits: [
          { day_number: 1, summary: "No restaurants", activities: [{ name: "Belém Tower", start_time: "10:00", duration_minutes: 90, type: "attraction" }] },
          { day_number: 2, summary: "No restaurants", activities: [{ name: "Livraria Lello", start_time: "12:30", duration_minutes: 60, type: "attraction" }] },
        ],
      }),
    usageMetadata: {},
  },
};
const input = { message: "no restaurants please", destination: "Lisbon & Porto", tripTitle: "Portugal", days, startDate: "2027-04-01", locale: "en" };

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
});

describe("assistTrip on a trip through two cities", () => {
  it("keeps the ride to the next city when the change rewrites its day for something else", async () => {
    generateContent.mockResolvedValue(withoutMeals);
    const out = await assistTrip(input);
    const day2 = out.edits.find((e) => e.day_number === 2)!;
    expect(day2.activities.map((a) => `${a.start_time} ${a.name}`)).toEqual(["08:30 Train to Porto", "12:30 Livraria Lello"]);
  });

  it("leaves it out when the traveller asks to get there another way", async () => {
    generateContent.mockResolvedValue(withoutMeals);
    const out = await assistTrip({ ...input, message: "no restaurants, and we'll drive to Porto ourselves" });
    const day2 = out.edits.find((e) => e.day_number === 2)!;
    expect(day2.activities.map((a) => a.name)).toEqual(["Livraria Lello"]);
  });

  it("leaves it out when a yes answers that ask", async () => {
    generateContent.mockResolvedValue(withoutMeals);
    const history = [
      { role: "user" as const, text: "no restaurants, and we'll drive to Porto ourselves" },
      { role: "assistant" as const, text: "Shall I take out the restaurants and the train to Porto?" },
    ];
    const out = await assistTrip({ ...input, message: "yes", history });
    const day2 = out.edits.find((e) => e.day_number === 2)!;
    expect(day2.activities.map((a) => a.name)).toEqual(["Livraria Lello"]);
  });
});
