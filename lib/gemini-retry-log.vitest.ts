/** @vitest-environment node */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A model answer that does not parse is retried once. The retried attempt is
 * a warning; only the attempt the caller fails on is an error, so the
 * runtime-error feed shows failures, not recoveries.
 */

vi.mock("@/lib/ai/genai-compat", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => ({
          response: { text: () => "{ not json", usageMetadata: {}, candidates: [{ finishReason: "STOP" }] },
        }),
      };
    }
  },
}));
vi.mock("./prompts", () => ({ getPrompt: async () => "system prompt" }));
vi.mock("./posthog/llm-analytics", async (original) => ({
  ...(await original<typeof import("./posthog/llm-analytics")>()),
  captureLLMGeneration: async () => {},
}));
vi.mock("./ai/gemini-cost", async (original) => ({
  ...(await original<typeof import("./ai/gemini-cost")>()),
  recordGeminiUsage: () => {},
}));

let regenerateSingleDay: typeof import("./gemini").regenerateSingleDay;
beforeAll(async () => {
  ({ regenerateSingleDay } = await import("./gemini"));
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

const parseLogs = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("JSON parse error"));

describe("a model answer that does not parse", () => {
  it("warns on the attempt that is retried and errors on the one that gives up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      regenerateSingleDay({
        destination: "Rome",
        dayNumber: 2,
        date: "2027-05-11",
        budgetTier: "balanced",
        pace: "moderate",
        vibes: ["cultural"],
        surroundingDays: [{ day_number: 1, date: "2027-05-10", activities: [] } as unknown as ItineraryDay],
      })
    ).rejects.toThrow("Failed to regenerate day after retries");
    expect(parseLogs(warn)).toEqual(["Day regeneration JSON parse error (attempt 1):"]);
    expect(parseLogs(error)).toEqual(["Day regeneration JSON parse error (attempt 2):"]);
  });
});
