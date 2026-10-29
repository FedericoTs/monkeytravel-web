import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** A plan is built first from the places travellers kept, after any must-dos. */

const prompts: string[] = [];
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          startChat: () => ({
            sendMessageStream: async (prompt: string) => {
              prompts.push(prompt);
              return {
                stream: (async function* () {})(),
                response: Promise.resolve({ text: () => "{}", usageMetadata: undefined }),
              };
            },
          }),
        };
      }
    },
  };
});
vi.mock("@/lib/prompts", () => ({ getPrompt: async () => "system", DEFAULT_PROMPTS: {} }));
vi.mock("@/lib/posthog/llm-analytics", () => ({ captureLLMGeneration: async () => {}, estimateCost: () => 0 }));

const { generateItineraryStream } = await import("./gemini");

const params = {
  destination: "Rome, Italy",
  startDate: "2027-05-01",
  endDate: "2027-05-03",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
} as TripCreationParams;

const known = [
  { name: "Colosseum", type: "landmark" as const },
  { name: "Roscioli", type: "restaurant" as const },
];

async function promptFor(trip: TripCreationParams, options: Parameters<typeof generateItineraryStream>[1]) {
  for await (const chunk of generateItineraryStream(trip, options)) void chunk;
  return prompts[prompts.length - 1];
}

beforeEach(() => {
  prompts.length = 0;
});

describe("the plan's prompt", () => {
  it("lists the places travellers kept, to build the days from first", async () => {
    const prompt = await promptFor(params, { knownPlaces: known });
    expect(prompt).toContain("## Places Travellers Kept Here");
    expect(prompt).toContain("Build the days from them first: use the ones that suit this trip");
    expect(prompt).toContain("- Colosseum (landmark)\n- Roscioli (restaurant)");
  });

  it("puts the traveller's must-dos before them", async () => {
    const prompt = await promptFor({ ...params, mustDos: ["Vatican Museums"] }, { knownPlaces: known });
    expect(prompt).toContain("Build the days from them first, after the must-dos:");
    expect(prompt.indexOf("## Traveller Must-Dos")).toBeLessThan(prompt.indexOf("## Places Travellers Kept Here"));
  });

  it("leaves them out of a part, which follows its outline, and out of a plan without any", async () => {
    const outline = [{ day_number: 1, theme: "t", area: "a", places: ["Colosseum"] }];
    expect(await promptFor(params, { knownPlaces: known, part: { from: 1, to: 1, outline } })).not.toContain("Travellers Kept");
    expect(await promptFor(params, {})).not.toContain("Travellers Kept");
  });
});
