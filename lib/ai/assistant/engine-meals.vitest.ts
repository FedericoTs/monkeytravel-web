/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * Asked to take the restaurants and cafés out, the model can answer that it took them all while one stays in the
 * plan. The engine takes out the ones it left, so the plan says what the reply says.
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

const stop = (id: string, name: string, start_time: string, type = "attraction") => ({ id, name, start_time, time_slot: "morning", duration_minutes: 60, type });
const days = [
  { day_number: 1, date: "2027-05-10", activities: [stop("a1", "Pastéis de Belém", "09:00", "cafe"), stop("a2", "Jerónimos Monastery", "10:00"), stop("a3", "Time Out Market", "13:00", "restaurant")] },
  { day_number: 2, date: "2027-05-11", activities: [stop("b1", "Fábrica Coffee Roasters", "09:00", "cafe"), stop("b2", "Castelo de São Jorge", "10:00"), stop("b3", "Cervejaria Ramiro", "12:30", "restaurant")] },
  { day_number: 3, date: "2027-05-12", activities: [stop("c1", "Manteigaria", "09:00", "cafe"), stop("c2", "Gulbenkian Museum", "10:00", "museum"), stop("c3", "O Velho Eurico", "13:00", "restaurant")] },
] as unknown as ItineraryDay[];
const answer = (reply: string) => ({
  response: {
    text: () =>
      JSON.stringify({
        reply,
        edits: [
          // Day 1 keeps its café and its lunch; the other days lose theirs.
          { day_number: 1, summary: "No food", activities: [{ name: "Pastéis de Belém", start_time: "09:00", duration_minutes: 60, type: "cafe" }, { name: "Jerónimos Monastery", start_time: "10:00", duration_minutes: 60, type: "attraction" }, { name: "Time Out Market", start_time: "13:00", duration_minutes: 60, type: "restaurant" }] },
          { day_number: 2, summary: "No food", activities: [{ name: "Castelo de São Jorge", start_time: "10:00", duration_minutes: 60, type: "attraction" }] },
          { day_number: 3, summary: "No food", activities: [{ name: "Gulbenkian Museum", start_time: "10:00", duration_minutes: 60, type: "museum" }] },
        ],
      }),
    usageMetadata: {},
  },
});
const input = { message: "remove all the restaurants and cafes", destination: "Lisbon, Portugal", tripTitle: "Lisbon", days, startDate: "2027-05-10", locale: "en" };

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
});

describe("assistTrip asked to take the food out", () => {
  it("takes out the café and the lunch its reply said it removed with the rest", async () => {
    generateContent.mockResolvedValue(answer("I've removed all the restaurants and cafés from your trip."));
    const out = await assistTrip(input);
    expect(out.edits.find((e) => e.day_number === 1)!.activities.map((a) => a.name)).toEqual(["Jerónimos Monastery"]);
  });

  it("leaves them when the reply doesn't say it took them all", async () => {
    generateContent.mockResolvedValue(answer("All set: days 2 and 3 have no meals now."));
    const out = await assistTrip(input);
    // Day 1 as the change leaves it: returned as it was, it isn't among the changed days.
    const day1 = out.edits.find((e) => e.day_number === 1)?.activities ?? days[0].activities;
    expect(day1.map((a) => a.name)).toEqual(["Pastéis de Belém", "Jerónimos Monastery", "Time Out Market"]);
  });
});
