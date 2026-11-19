import { afterEach, describe, expect, it, vi } from "vitest";

// What the route question asks the model for, read from the model it builds: no model is called.
const built: Array<{ generationConfig?: { responseSchema?: unknown } }> = [];
vi.mock("@/lib/ai/gemini-call", () => ({
  genAI: {
    getGenerativeModel: (params: { generationConfig?: { responseSchema?: unknown } }) => {
      built.push(params);
      return { generateContent: async () => ({ response: { text: () => '{"stops":[]}', usageMetadata: undefined } }) };
    },
  },
  withTimeout: <T>(promise: Promise<T>) => promise,
}));
vi.mock("@/lib/ai/gemini-cost", () => ({ geminiCostUsd: () => 0, recordGeminiUsage: () => {} }));

import { askForRoute } from "./route-plan";

afterEach(() => {
  vi.unstubAllEnvs();
  built.length = 0;
});

describe("askForRoute", () => {
  // A longer list is turned down whole (readRoute): a three-week country came back with seven bases and got no route.
  it("asks for no more bases than a trip through several cities takes", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    await askForRoute("Vietnam", 21, 3, "en");
    expect(built).toHaveLength(1);
    const schema = built[0].generationConfig?.responseSchema as { properties: { stops: { maxItems?: string } } };
    expect(schema.properties.stops.maxItems).toBe("5");
  });
});
