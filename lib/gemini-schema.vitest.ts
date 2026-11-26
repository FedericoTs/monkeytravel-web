/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** Both plan calls, the one that answers at once and the one that streams, ask for the plan's shape as their schema. */

const configs = vi.hoisted(() => [] as Array<{ generationConfig?: { responseSchema?: unknown; responseMimeType?: string } }>);
const plan = { destination: { name: "Rome", country: "Italy" }, days: [{ day_number: 1, date: "2027-05-01", theme: "t", activities: [] }] };

vi.mock("@/lib/ai/genai-compat", async (original) => ({
  ...(await original<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel(config: (typeof configs)[number]) {
      configs.push(config);
      return {
        startChat: () => ({
          sendMessage: async () => ({ response: { text: () => JSON.stringify(plan), usageMetadata: {}, candidates: [{ finishReason: "STOP" }] } }),
          sendMessageStream: async () => ({
            stream: (async function* () {
              yield { text: () => JSON.stringify(plan), usageMetadata: {} };
            })(),
            response: Promise.resolve({ text: () => JSON.stringify(plan), usageMetadata: {}, candidates: [{ finishReason: "STOP" }] }),
          }),
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

const { generateItinerary, generateItineraryStream } = await import("./gemini");
const { PLAN_SCHEMA } = await import("./ai/plan-schema");

const trip = {
  destination: "Rome, Italy",
  startDate: "2027-05-01",
  endDate: "2027-05-01",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
} as TripCreationParams;

describe("the plan calls", () => {
  it("ask for the plan's shape as their response schema, at once and streamed", async () => {
    await generateItinerary(trip);
    expect(configs.at(-1)?.generationConfig?.responseSchema).toBe(PLAN_SCHEMA);
    for await (const chunk of generateItineraryStream({ ...trip, destination: "Florence, Italy" })) {
      if ((chunk as { done?: boolean }).done) break;
    }
    expect(configs.at(-1)?.generationConfig?.responseSchema).toBe(PLAN_SCHEMA);
    expect(configs.at(-1)?.generationConfig?.responseMimeType).toBe("application/json");
  });
});
