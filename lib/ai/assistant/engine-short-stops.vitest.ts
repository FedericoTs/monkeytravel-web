/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A traveller set a walk's stops to 5 and 1 minutes; every reply said done and
 * every stop was saved at 15, so they left. Short visits are kept, a stop asked
 * for shorter than a stop can be is set to the shortest, and the reply says so.
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

const stop = (name: string, start_time: string, duration_minutes: number) => ({ name, time_slot: "morning", start_time, duration_minutes });
const day = (n: number) =>
  ({ day_number: n, date: `2027-11-1${n}`, activities: [stop(`Day ${n} thing`, "10:00", 60)] }) as unknown as ItineraryDay;
const input = {
  message: "Broadwick Street 5 min, Neal's Yard 10 min, Conduit Court Passage 1 min on day 1",
  destination: "London, United Kingdom",
  tripTitle: "London",
  days: [day(1), day(2)],
  locale: "en",
};
const modelAnswer = {
  reply: "Here is Day 1 with your short stops.",
  edits: [
    {
      day_number: 1,
      summary: "A short walk through Soho",
      activities: [stop("Broadwick Street", "10:00", 5), stop("Neal's Yard", "10:10", 10), stop("Conduit Court Passage", "10:25", 1)],
    },
  ],
};

let mod: typeof import("./engine");

beforeEach(async () => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
  generateContent.mockResolvedValue({ response: { text: () => JSON.stringify(modelAnswer) } });
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  mod = await import("./engine");
});

afterEach(() => {
  vi.useRealTimers();
});

async function run() {
  const p = mod.assistTrip(input);
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe("short stops through the assistant", () => {
  it("keeps 5 and 10 minutes, sets 1 minute to the shortest, and says which", async () => {
    const out = await run();
    const day1 = out.edits?.find((e) => e.day_number === 1);
    expect(day1?.activities.map((a) => [a.name, a.duration_minutes])).toEqual([
      ["Broadwick Street", 5],
      ["Neal's Yard", 10],
      ["Conduit Court Passage", 5],
    ]);
    expect(out.reply).toContain("Conduit Court Passage: set to 5 min, the shortest a stop can be.");
    expect(out.reply).not.toContain("Broadwick Street: set to");
  });
});
