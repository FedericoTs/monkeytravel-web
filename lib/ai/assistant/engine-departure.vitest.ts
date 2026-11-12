/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * The plan's own way home on its last day ("Flight home 18:00") holds as when
 * the traveller leaves: a change keeps it at its time unless the message gives
 * one, asks the model again when the day still plans something after setting
 * off, and says so when the second reply does too.
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

const stop = (id: string, name: string, start_time: string, type = "attraction") => ({ id, name, start_time, time_slot: "afternoon", duration_minutes: 90, type });
const days = [
  { day_number: 1, date: "2027-03-10", activities: [stop("a1", "Castelo de São Jorge", "10:00")] },
  { day_number: 2, date: "2027-03-11", activities: [stop("a2", "Chiado walk", "10:00"), stop("a3", "Flight home", "18:00", "transport")] },
] as unknown as ItineraryDay[];
// The model moves the flight home earlier and puts dinner after it, every time it's asked.
const movedHome = {
  response: {
    text: () =>
      JSON.stringify({
        reply: "Added a farewell dinner on Day 2.",
        edits: [
          {
            day_number: 2,
            activities: [
              { name: "Chiado walk", start_time: "10:00", duration_minutes: 90, type: "attraction" },
              { name: "Flight home", start_time: "15:00", duration_minutes: 120, type: "transport" },
              { name: "Farewell dinner at Cervejaria Ramiro", start_time: "20:00", duration_minutes: 90, type: "restaurant" },
            ],
          },
        ],
      }),
    usageMetadata: {},
  },
};
const input = { message: "add a farewell dinner on the last day", destination: "Lisbon, Portugal", tripTitle: "Lisbon", days, startDate: "2027-03-10", locale: "en" };
const promptOf = (req: unknown) => (req as { contents: { parts: { text: string }[] }[] }).contents[0].parts[0].text;

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
});

describe("assistTrip on the plan's own way home", () => {
  it("keeps it at its time, asks again about the dinner after it, and says so when it stays", async () => {
    generateContent.mockResolvedValue(movedHome);
    const out = await assistTrip(input);
    const last = out.edits.find((e) => e.day_number === 2)!;
    expect(last.activities.find((a) => a.name === "Flight home")?.start_time).toBe("18:00");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(promptOf(generateContent.mock.calls[1][0])).toContain("CORRECTION");
    expect(out.reply).toContain("(Check Day 2: you leave at 18:00, so plans should end by 15:00, and the day still has: Farewell dinner at Cervejaria Ramiro (20:00).)");
  });

  it("moves it when the message gives the time", async () => {
    generateContent.mockResolvedValue(movedHome);
    const out = await assistTrip({ ...input, message: "our flight home is at 15:00 now, add a farewell lunch before it" });
    const last = out.edits.find((e) => e.day_number === 2)!;
    expect(last.activities.find((a) => a.name === "Flight home")?.start_time).toBe("15:00");
  });
});
