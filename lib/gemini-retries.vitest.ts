/** @vitest-environment node */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ItineraryDay, TripCreationParams } from "@/types";
import { isModelOutOfCredit } from "./ai/model-outage";

/**
 * A model call is retried once: an answer that cannot be used is asked for
 * again at once, a call that failed (an error, a timeout) after a second.
 * Out of retries, the error says which of the two it was.
 */

const model = vi.hoisted(() => ({ answers: [] as Array<() => Promise<unknown>>, names: [] as string[] }));

vi.mock("@/lib/ai/genai-compat", async (original) => ({
  ...(await original<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel({ model: name }: { model: string }) {
      model.names.push(name);
      const next = () => (model.answers.shift() ?? (() => Promise.reject(new Error("no answer left"))))();
      return { generateContent: next, startChat: () => ({ sendMessage: next }) };
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

let gemini: typeof import("./ai/regenerate-day") & typeof import("./gemini");
beforeAll(async () => {
  gemini = { ...(await import("./ai/regenerate-day")), ...(await import("./gemini")) };
}, 60_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  model.answers.length = 0;
  model.names.length = 0;
});

const says = (text: string) => () =>
  Promise.resolve({ response: { text: () => text, usageMetadata: {}, candidates: [{ finishReason: "STOP" }] } });
const fails = (message: string) => () => Promise.reject(new Error(message));
const hangs = () => new Promise(() => {});

const DAY = JSON.stringify({
  theme: "Trastevere",
  activities: [{ name: "Gianicolo", type: "attraction", time_slot: "morning", coordinates: { lat: 41.8919, lng: 12.4611 } }],
});
const regenerateDay = () =>
  gemini.regenerateSingleDay({
    destination: "Rome",
    dayNumber: 2,
    date: "2027-05-11",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: ["cultural"],
    surroundingDays: [{ day_number: 1, date: "2027-05-10", activities: [] } as unknown as ItineraryDay],
  });

function quiet() {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
}

describe("a model call's retries", () => {
  it("asks again at once for an answer it cannot use, the second time from the sibling model", async () => {
    quiet();
    const pauses = vi.spyOn(globalThis, "setTimeout");
    model.answers.push(says("{ not json"), says(DAY));
    await expect(regenerateDay()).resolves.toMatchObject({ day_number: 2, theme: "Trastevere" });
    expect(pauses.mock.calls.map((call) => call[1])).not.toContain(1000);
    expect(model.names).toHaveLength(2);
    expect(model.names[1]).not.toBe(model.names[0]);
  });

  it("gives up after a second answer it cannot use, without a third try", async () => {
    quiet();
    model.answers.push(says("{ not json"), says("[]"), says(DAY));
    await expect(regenerateDay()).rejects.toThrow("Failed to regenerate day after retries");
    expect(model.answers).toHaveLength(1);
  });

  it("asks again a second after a call that failed", async () => {
    quiet();
    vi.useFakeTimers();
    model.answers.push(fails("503 Service Unavailable"), says(DAY));
    const day = regenerateDay();
    await vi.advanceTimersByTimeAsync(999);
    expect(model.names).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(model.names).toHaveLength(2);
    await expect(day).resolves.toMatchObject({ day_number: 2 });
  });

  it("asks again after a call that hangs past its timeout", async () => {
    quiet();
    vi.useFakeTimers();
    model.answers.push(hangs, says(DAY));
    const day = regenerateDay();
    await vi.advanceTimersByTimeAsync(50_000 + 1_000);
    await expect(day).resolves.toMatchObject({ day_number: 2 });
    expect(console.error).toHaveBeenCalledWith(
      "Gemini API error during day regeneration:",
      expect.objectContaining({ message: "Day regeneration timed out after 50s" })
    );
  });

  it("keeps the model's words, which is how a route tells a refusal no try can fix", async () => {
    quiet();
    vi.useFakeTimers();
    const refusal = `{"error":{"code":402,"message":"Your prepayment credits are depleted."}}`;
    model.answers.push(fails(refusal), fails(refusal));
    const day = regenerateDay().catch((error: Error) => error);
    await vi.runAllTimersAsync();
    expect(isModelOutOfCredit(await day)).toBe(true);
  });

  it("doesn't ask again when the model is out of credit", async () => {
    quiet();
    const refusal = `{"error":{"code":402,"message":"Your prepayment credits are depleted."}}`;
    model.answers.push(fails(refusal), says(DAY));
    await expect(regenerateDay()).rejects.toThrow("prepayment credits");
    expect(model.answers).toHaveLength(1);
  });

  it("says the service is unavailable after a second failed call", async () => {
    quiet();
    vi.useFakeTimers();
    model.answers.push(fails("503 Service Unavailable"), fails("503 Service Unavailable"), says(DAY));
    const day = expect(regenerateDay()).rejects.toThrow("Failed to regenerate day: AI service unavailable");
    await vi.runAllTimersAsync();
    await day;
    expect(model.answers).toHaveLength(1);
  });

  it("names the root cause when a trip cannot be generated, and keeps it as the cause", async () => {
    quiet();
    vi.useFakeTimers();
    model.answers.push(fails("403 API key banned"), fails("403 API key banned"));
    const trip = gemini
      .generateItinerary({
        destination: "Rome, Italy",
        startDate: "2027-05-10",
        endDate: "2027-05-12",
        budgetTier: "balanced",
        pace: "moderate",
        vibes: ["cultural"],
        interests: [],
      } as TripCreationParams)
      .catch((error: Error & { cause?: Error }) => error);
    await vi.runAllTimersAsync();
    const error = (await trip) as Error & { cause?: Error };
    expect(error.message).toBe("Failed to generate itinerary: AI service unavailable (root: 403 API key banned)");
    expect(error.cause?.message).toBe("403 API key banned");
  });
});
