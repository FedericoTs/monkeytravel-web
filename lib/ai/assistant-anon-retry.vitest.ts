/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A 503 "high demand" from Gemini used to fail the wizard assistant outright.
 * It now gets one retry on the sibling model; other errors still fail fast.
 */

const generateContent = vi.fn();
const modelsAsked: string[] = [];

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel({ model }: { model: string }) {
        return {
          generateContent: (req: unknown) => {
            modelsAsked.push(model);
            return generateContent(req);
          },
        };
      }
    },
  };
});

vi.mock("@/lib/gemini", () => ({ logCacheMetrics: vi.fn() }));

const overloaded = () => Object.assign(new Error("This model is currently experiencing high demand."), { status: 503 });
const answer = () => ({ response: { text: () => JSON.stringify({ reply: "Done.", edits: [] }) } });
const day = (n: number) =>
  ({ day_number: n, date: `2027-11-1${n}`, activities: [{ name: `Day ${n} thing`, time_slot: "morning" }] }) as unknown as ItineraryDay;
const input = { message: "What is on day 1?", destination: "Rome, Italy", tripTitle: "Rome", days: [day(1), day(2)], locale: "en" };

let mod: typeof import("./assistant-anon");

beforeEach(async () => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
  modelsAsked.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  mod = await import("./assistant-anon");
});

afterEach(() => {
  vi.useRealTimers();
});

async function run() {
  const p = mod.assistTrip(input);
  // Handled by the caller's expect; marked here so it isn't reported early.
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe("assistTrip on an overloaded model", () => {
  it("answers from the sibling model after a 503", async () => {
    generateContent.mockRejectedValueOnce(overloaded()).mockResolvedValueOnce(answer());
    const out = await run();
    expect(modelsAsked).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    expect(out.meta.model).toBe("gemini-2.5-flash-lite");
  });

  it("fails after one retry when both models are overloaded", async () => {
    generateContent.mockRejectedValue(overloaded());
    await expect(run()).rejects.toThrow("high demand");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error that is the request's own", async () => {
    generateContent.mockRejectedValueOnce(Object.assign(new Error("Invalid argument"), { status: 400 }));
    await expect(run()).rejects.toThrow("Invalid argument");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe("isModelOverloaded", () => {
  it("is true only for 429, 500 and 503", () => {
    expect([429, 500, 503].map((status) => mod.isModelOverloaded({ status }))).toEqual([true, true, true]);
    expect([400, 401, 404].map((status) => mod.isModelOverloaded({ status }))).toEqual([false, false, false]);
    expect(mod.isModelOverloaded(new Error("no status"))).toBe(false);
    expect(mod.isModelOverloaded(null)).toBe(false);
  });
});
