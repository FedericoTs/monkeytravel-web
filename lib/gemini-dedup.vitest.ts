/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/**
 * Two identical requests at the same moment share one model call. Anything that
 * changes the plan makes them two requests, and asking leaves the trip's answers
 * as they were.
 */

const prompts = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/ai/genai-compat", async (original) => ({
  ...(await original<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        startChat: () => ({
          sendMessage: async (prompt: string) => {
            prompts.push(prompt);
            const plan = { destination: { name: "Rome" }, days: [{ day_number: 1, date: "2027-05-01", activities: [] }] };
            return { response: { text: () => JSON.stringify(plan), usageMetadata: {}, candidates: [{ finishReason: "STOP" }] } };
          },
        }),
      };
    }
  },
}));
vi.mock("./prompts", () => ({ getPrompt: async () => "system prompt", DEFAULT_PROMPTS: {} }));
vi.mock("./posthog/llm-analytics", async (original) => ({
  ...(await original<typeof import("./posthog/llm-analytics")>()),
  captureLLMGeneration: async () => {},
}));
vi.mock("./ai/gemini-cost", async (original) => ({
  ...(await original<typeof import("./ai/gemini-cost")>()),
  recordGeminiUsage: () => {},
}));
vi.mock("./ai/plan-currency", () => ({ inPlanCurrency: async () => {} }));

const { generateItinerary } = await import("./gemini");

const trip = (over: Partial<TripCreationParams> = {}) =>
  ({
    destination: "Rome, Italy",
    startDate: "2027-05-01",
    endDate: "2027-05-03",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: ["romantic", "adventure"],
    interests: [],
    ...over,
  }) as TripCreationParams;

const callsFor = async (...trips: TripCreationParams[]) => {
  await Promise.all(trips.map((t) => generateItinerary(t)));
  return prompts.length;
};

beforeEach(() => {
  prompts.length = 0;
});

describe("requests at the same moment", () => {
  it("share one call when they're the same", async () => {
    expect(await callsFor(trip(), trip())).toBe(1);
  });

  it.each<[string, Partial<TripCreationParams>, Partial<TripCreationParams>]>([
    ["who's coming", { tripIntent: "solo" }, { tripIntent: "group" }],
    ["who's coming, against no answer", { tripIntent: "solo" }, {}],
    ["the must-dos", { mustDos: ["Vatican Museums"] }, { mustDos: ["Borghese Gallery"] }],
    ["the diet", { profilePreferences: { dietaryPreferences: ["vegan"] } }, {}],
    ["the requirements", { requirements: "step-free" }, {}],
    ["the style", { travelStyle: "backpacker" }, { travelStyle: "classic" }],
    ["the interests", { interests: ["art"] }, { interests: ["food"] }],
    ["where they're staying", { stay: { name: "Trastevere" } }, { stay: { name: "Termini" } }],
    ["where they're staying, against no answer", { stay: { name: "Trastevere" } }, {}],
  ])("are two calls when %s differ", async (_, one, other) => {
    expect(await callsFor(trip(one), trip(other))).toBe(2);
  });
});

describe("the vibes", () => {
  it("stay in the order they were chosen, the first counting most", async () => {
    const chosen = trip();
    await generateItinerary(chosen);
    expect(chosen.vibes).toEqual(["romantic", "adventure"]);
    expect(prompts[0]).toMatch(/50% Primary: Romantic/);
  });
});
